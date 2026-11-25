import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/security";
import { notifyAdmin } from "@/lib/notify";
import { addressProblem, pickAssetNetwork } from "@/lib/asset-rules";
import { fail, ok, type ServiceResult } from "@/lib/services/result";

/**
 * The asset and network registry: which crypto assets trade on which networks, where
 * deposits go, how many confirmations they need, and whether the desk can send the asset
 * out. Prices stay on Rate. Admins manage this; nothing in the code lists assets or networks.
 */

const NETWORK_SELECT = {
  id: true,
  code: true,
  name: true,
  addressPattern: true,
  addressHint: true,
  explorerTxUrl: true,
  defaultConfirmations: true,
  isActive: true,
} as const;

async function assetNetworkRows(symbol: string) {
  return prisma.assetNetwork.findMany({
    where: { symbol },
    include: { network: { select: NETWORK_SELECT } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export type ResolvedAssetNetwork = Awaited<ReturnType<typeof assetNetworkRows>>[number];

/** The network an order for `symbol` uses (see pickAssetNetwork), or why it cannot trade. */
export async function resolveAssetNetwork(
  symbol: string,
  side: "SELL" | "BUY",
  requested?: string | null,
): Promise<ServiceResult<ResolvedAssetNetwork>> {
  const rows = await assetNetworkRows(symbol);
  const picked = pickAssetNetwork(
    rows.map((r) => ({ ...r, code: r.network.code, networkActive: r.network.isActive })),
    side,
    requested,
  );
  if (!picked.ok) return fail(picked.error, 422);
  return ok(rows.find((r) => r.id === picked.option.id)!);
}

/** True when the asset can trade on at least one network in this direction. */
export async function assetTradable(symbol: string, side: "SELL" | "BUY"): Promise<boolean> {
  const rows = await assetNetworkRows(symbol);
  return rows.some((r) => r.network.isActive && (side === "SELL" ? r.depositsEnabled : r.withdrawalsEnabled));
}

/** Where to send each asset when selling, one entry per asset (its default network). */
export async function defaultDepositWallets() {
  const rows = await prisma.assetNetwork.findMany({
    where: { depositsEnabled: true, network: { isActive: true } },
    include: { network: { select: { code: true } } },
    orderBy: [{ symbol: "asc" }, { isDefault: "desc" }, { createdAt: "asc" }],
  });
  const seen = new Set<string>();
  return rows
    .filter((r) => !seen.has(r.symbol) && seen.add(r.symbol))
    .map((r) => ({ symbol: r.symbol, network: r.network.code, address: r.depositAddress, memo: r.depositMemo, note: r.note }));
}

/** Every network each asset can use, for clients choosing where to send or receive. */
export async function listAssetNetworks(opts: { includeAddresses: boolean }) {
  const rows = await prisma.assetNetwork.findMany({
    where: { network: { isActive: true }, OR: [{ depositsEnabled: true }, { withdrawalsEnabled: true }] },
    include: { network: { select: { code: true, name: true } } },
    orderBy: [{ symbol: "asc" }, { isDefault: "desc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    symbol: r.symbol,
    network: r.network.code,
    networkName: r.network.name,
    isDefault: r.isDefault,
    sell: r.depositsEnabled,
    buy: r.withdrawalsEnabled,
    confirmations: r.confirmations,
    note: r.note,
    ...(opts.includeAddresses ? { depositAddress: r.depositAddress, depositMemo: r.depositMemo } : {}),
  }));
}

/** Everything the admin desk needs to manage the registry. */
export async function adminRegistry() {
  const [networks, assetNetworks, cryptoRates] = await Promise.all([
    prisma.blockchainNetwork.findMany({ orderBy: { code: "asc" }, select: NETWORK_SELECT }),
    prisma.assetNetwork.findMany({
      include: { network: { select: { code: true, name: true, isActive: true } } },
      orderBy: [{ symbol: "asc" }, { isDefault: "desc" }, { createdAt: "asc" }],
    }),
    prisma.rate.findMany({ where: { kind: "CRYPTO" }, orderBy: { sortOrder: "asc" }, select: { symbol: true, displayName: true } }),
  ]);
  return { networks, assetNetworks, cryptoRates };
}

// ---------------------------------------------------------------- admin changes

type Admin = { id: string };

const flag = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());
const memo = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().max(64).nullable());
const note = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().max(200).nullable());

const updateSchema = z.object({
  id: z.string().min(1),
  depositAddress: z.string().trim().min(10, "Enter the deposit address.").max(128),
  depositMemo: memo,
  confirmations: z.coerce.number().int().min(1, "At least 1 confirmation.").max(1000),
  depositsEnabled: flag,
  withdrawalsEnabled: flag,
  isDefault: flag,
  note,
});

const addSchema = z.object({
  symbol: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{2,15}$/, "Pick an asset.")),
  networkId: z.string().min(1, "Pick a network."),
  depositAddress: z.string().trim().min(10, "Enter the deposit address.").max(128),
  depositMemo: memo,
  note,
});

/**
 * Change an asset's settings on one network. Deposit address changes are always audited and alerted.
 * With `dryRun`, only checks the change and describes it (for a two-person approval request).
 */
export async function updateAssetNetwork(
  admin: Admin,
  input: unknown,
  opts: { dryRun?: boolean } = {},
): Promise<ServiceResult<{ summary: string; targetVersion: string } | null>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const d = parsed.data;

  const before = await prisma.assetNetwork.findUnique({ where: { id: d.id }, include: { network: true } });
  if (!before) return fail("Not found.", 404);
  const problem = addressProblem(d.depositAddress, before.network);
  if (problem) return fail(`Deposit address: ${problem}`, 422);
  if (before.isDefault && !d.isDefault) {
    return fail("Every asset needs a default network. Make another network the default instead.", 409);
  }

  if (opts.dryRun) {
    const changes: string[] = [];
    const was = (label: string, from: unknown, to: unknown) => {
      if (from !== to) changes.push(`${label}: ${from ?? "none"} → ${to ?? "none"}`);
    };
    was("deposit address", before.depositAddress, d.depositAddress.trim());
    was("memo", before.depositMemo ?? null, d.depositMemo);
    was("confirmations", before.confirmations, d.confirmations);
    was("sell", before.depositsEnabled ? "on" : "off", d.depositsEnabled ? "on" : "off");
    was("buy", before.withdrawalsEnabled ? "on" : "off", d.withdrawalsEnabled ? "on" : "off");
    was("default", before.isDefault ? "yes" : "no", d.isDefault ? "yes" : "no");
    was("note", before.note ?? null, d.note);
    if (changes.length === 0) return fail("Nothing changed.", 422);
    return ok({
      summary: `${before.symbol} on ${before.network.code}: ${changes.join("; ")}`,
      // Approval is refused if the row changes between the request and the decision.
      targetVersion: before.updatedAt.toISOString(),
    });
  }

  await prisma.$transaction(async (tx) => {
    // One default per asset: moving the default clears it elsewhere first.
    if (d.isDefault && !before.isDefault) {
      await tx.assetNetwork.updateMany({ where: { symbol: before.symbol, isDefault: true }, data: { isDefault: false } });
    }
    await tx.assetNetwork.update({
      where: { id: d.id },
      data: {
        depositAddress: d.depositAddress.trim(),
        depositMemo: d.depositMemo,
        confirmations: d.confirmations,
        depositsEnabled: d.depositsEnabled,
        withdrawalsEnabled: d.withdrawalsEnabled,
        isDefault: d.isDefault,
        note: d.note,
      },
    });
  });

  const addressChanged = before.depositAddress !== d.depositAddress.trim() || (before.depositMemo ?? null) !== d.depositMemo;
  await writeAudit("admin.asset_network_update", {
    userId: admin.id,
    meta: {
      symbol: before.symbol,
      network: before.network.code,
      from: {
        depositAddress: before.depositAddress,
        depositMemo: before.depositMemo,
        confirmations: before.confirmations,
        depositsEnabled: before.depositsEnabled,
        withdrawalsEnabled: before.withdrawalsEnabled,
        isDefault: before.isDefault,
      },
      to: {
        depositAddress: d.depositAddress.trim(),
        depositMemo: d.depositMemo,
        confirmations: d.confirmations,
        depositsEnabled: d.depositsEnabled,
        withdrawalsEnabled: d.withdrawalsEnabled,
        isDefault: d.isDefault,
      },
    },
  });
  if (addressChanged) {
    // Deposit address changes are high-risk: always alert, whoever made them.
    void notifyAdmin("admin.deposit_address_changed", {
      symbol: before.symbol,
      network: before.network.code,
      address: d.depositAddress.trim(),
      adminId: admin.id,
    });
  }
  return ok(null, `${before.symbol} on ${before.network.code} saved.`);
}

/**
 * Put an existing asset on another network. It starts with deposits and withdrawals off.
 * With `dryRun`, only checks it and describes it (for a two-person approval request).
 */
export async function addAssetNetwork(
  admin: Admin,
  input: unknown,
  opts: { dryRun?: boolean } = {},
): Promise<ServiceResult<{ summary: string; targetVersion: string } | null>> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const d = parsed.data;

  const [rate, network, existing] = await Promise.all([
    prisma.rate.findUnique({ where: { kind_symbol: { kind: "CRYPTO", symbol: d.symbol } } }),
    prisma.blockchainNetwork.findUnique({ where: { id: d.networkId } }),
    prisma.assetNetwork.count({ where: { symbol: d.symbol } }),
  ]);
  if (!rate) return fail("That asset has no rate yet. Add the asset's rate first.", 422);
  if (!network || !network.isActive) return fail("Pick an active network.", 422);
  const problem = addressProblem(d.depositAddress, network);
  if (problem) return fail(`Deposit address: ${problem}`, 422);

  if (opts.dryRun) {
    if (await prisma.assetNetwork.findUnique({ where: { symbol_networkId: { symbol: d.symbol, networkId: network.id } } })) {
      return fail(`${d.symbol} is already on ${network.code}.`, 409);
    }
    return ok({
      summary: `Add ${d.symbol} on ${network.code} with deposit address ${d.depositAddress.trim()}${d.depositMemo ? ` (memo ${d.depositMemo})` : ""}. Starts switched off.`,
      targetVersion: "new",
    });
  }

  try {
    await prisma.assetNetwork.create({
      data: {
        symbol: d.symbol,
        networkId: network.id,
        depositAddress: d.depositAddress.trim(),
        depositMemo: d.depositMemo,
        note: d.note,
        confirmations: network.defaultConfirmations,
        // Off until someone has checked custody and liquidity and switches it on.
        depositsEnabled: false,
        withdrawalsEnabled: false,
        // An asset's first network becomes its default.
        isDefault: existing === 0,
      },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return fail(`${d.symbol} is already on ${network.code}.`, 409);
    throw err;
  }

  await writeAudit("admin.asset_network_add", {
    userId: admin.id,
    meta: { symbol: d.symbol, network: network.code, depositAddress: d.depositAddress.trim() },
  });
  void notifyAdmin("admin.deposit_address_changed", {
    symbol: d.symbol,
    network: network.code,
    address: d.depositAddress.trim(),
    adminId: admin.id,
  });
  return ok(null, `${d.symbol} added on ${network.code}. It is switched off: check it, then enable deposits or withdrawals.`);
}
