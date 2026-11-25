import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/security";
import { notifyAdmin } from "@/lib/notify";
import { errorMessage, log } from "@/lib/log";
import { classifyAmount, depositConfig, normalizeAddress, pickOrderForDeposit } from "@/lib/deposit-rules";
import {
  activeDepositProvider,
  depositProviderNamed,
  signSimulatedWebhook,
  simulatedDepositsAllowed,
  type DepositEvent,
} from "@/lib/deposits/provider";
import { pushNotification } from "@/lib/services/notifications";
import { fail, ok, type ServiceResult } from "@/lib/services/result";
import type { DepositStatus } from "@/generated/prisma/enums";

/**
 * Blockchain deposits, provider-neutral.
 *
 *   1. Each customer gets their own deposit address per asset and network (customerDepositAddress).
 *   2. The provider reports transfers to those addresses by webhook. Every webhook is stored first,
 *      then processed; a repeated delivery is recognised and skipped.
 *   3. A transfer waits (PENDING) until it has the confirmations the registry asks for, then is
 *      matched to the customer's open sell order and the order goes to the desk for review.
 *   4. Anything unusual becomes an exception for a person: unmatched, short, over, wrong asset, or
 *      a transfer that left the chain. Nothing here pays anyone; the desk still approves payouts.
 */

const EXCEPTIONS: DepositStatus[] = ["UNDERPAID", "OVERPAID", "UNMATCHED", "WRONG_ASSET", "REVERSED"];

// ---------------------------------------------------------------- addresses

/**
 * The customer's own deposit address for an asset on a network, created on first use. Null when no
 * deposit provider is active: the caller then falls back to the desk's shared address.
 */
export async function customerDepositAddress(
  userId: string,
  symbol: string,
  network: { id: string; code: string },
): Promise<{ address: string; memo: string | null } | null> {
  const provider = activeDepositProvider();
  if (!provider) return null;
  const key = { userId_symbol_networkId: { userId, symbol, networkId: network.id } };
  const existing = await prisma.depositAddress.findUnique({ where: key });
  if (existing) return { address: existing.address, memo: existing.memo };

  const issued = await provider.createAddress({ userId, symbol, networkCode: network.code });
  try {
    const row = await prisma.depositAddress.create({
      data: {
        userId,
        symbol,
        networkId: network.id,
        address: normalizeAddress(issued.address),
        memo: issued.memo ?? null,
        provider: provider.name,
        providerRef: issued.providerRef ?? null,
      },
    });
    return { address: row.address, memo: row.memo };
  } catch (err) {
    // Two requests created one at the same moment: use the one that won.
    if ((err as { code?: string })?.code !== "P2002") throw err;
    const winner = await prisma.depositAddress.findUniqueOrThrow({ where: key });
    return { address: winner.address, memo: winner.memo };
  }
}

/** Replaces the shared desk address in a wallet list with the customer's own, when a provider is active. */
export async function personaliseWallets<T extends { symbol: string; network: string; address: string; memo?: string | null }>(
  userId: string,
  wallets: T[],
): Promise<T[]> {
  if (!activeDepositProvider()) return wallets;
  const networks = await prisma.blockchainNetwork.findMany({
    where: { code: { in: [...new Set(wallets.map((w) => w.network))] } },
    select: { id: true, code: true },
  });
  const byCode = new Map(networks.map((n) => [n.code, n]));
  return Promise.all(
    wallets.map(async (w) => {
      const network = byCode.get(w.network);
      const own = network ? await customerDepositAddress(userId, w.symbol, network) : null;
      return own ? { ...w, address: own.address, ...("memo" in w ? { memo: own.memo } : {}) } : w;
    }),
  );
}

// ---------------------------------------------------------------- webhooks

export type WebhookResult = { status: number; body: Record<string, unknown> };

/** Stores, verifies and processes a deposit provider's webhook. Safe to deliver more than once. */
export async function handleDepositWebhook(providerName: string, rawBody: string, headers: Pick<Headers, "get">): Promise<WebhookResult> {
  const provider = depositProviderNamed(providerName);
  if (!provider) return { status: 404, body: { error: "Unknown deposit provider." } };

  const signatureOk = provider.verifyWebhook(rawBody, headers);
  let events: DepositEvent[];
  try {
    events = provider.parseWebhook(rawBody);
  } catch (err) {
    await prisma.webhookEvent.create({
      data: { provider: provider.name, eventId: `unparsable-${Date.now()}-${randomBytes(4).toString("hex")}`, signatureOk, payload: rawBody.slice(0, 20_000), error: errorMessage(err) },
    });
    return { status: 400, body: { error: "Unreadable webhook." } };
  }

  let processed = 0;
  let duplicates = 0;
  for (const event of events) {
    const stored = await storeEvent(provider.name, event.eventId, signatureOk, JSON.stringify(event));
    if (stored === "seen") {
      duplicates++;
      continue;
    }
    // A forged or tampered webhook is kept for investigation and never acted on.
    if (!signatureOk) continue;
    try {
      await processDepositEvent(provider.name, event);
      await prisma.webhookEvent.update({ where: { provider_eventId: { provider: provider.name, eventId: event.eventId } }, data: { processedAt: new Date(), error: null } });
      processed++;
    } catch (err) {
      log.error("deposits: event failed", { provider: provider.name, eventId: event.eventId, error: errorMessage(err) });
      await prisma.webhookEvent.update({ where: { provider_eventId: { provider: provider.name, eventId: event.eventId } }, data: { error: errorMessage(err).slice(0, 500) } });
      // Ask the provider to deliver again later.
      return { status: 500, body: { error: "Processing failed; will retry." } };
    }
  }
  if (!signatureOk) {
    log.warn("deposits: bad webhook signature", { provider: provider.name });
    return { status: 401, body: { error: "Invalid signature." } };
  }
  return { status: 200, body: { ok: true, processed, duplicates } };
}

/** "new" the first time an event arrives (or when an earlier attempt failed), "seen" once it was processed. */
async function storeEvent(provider: string, eventId: string, signatureOk: boolean, payload: string): Promise<"new" | "seen"> {
  try {
    await prisma.webhookEvent.create({ data: { provider, eventId, signatureOk, payload } });
    return "new";
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2002") throw err;
    const earlier = await prisma.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider, eventId } } });
    return earlier.processedAt ? "seen" : "new";
  }
}

// ---------------------------------------------------------------- processing

async function requiredConfirmations(symbol: string, networkCode: string): Promise<number> {
  const row = await prisma.assetNetwork.findFirst({ where: { symbol, network: { code: networkCode } }, select: { confirmations: true } });
  return row?.confirmations ?? 1;
}

/** Applies one reported transfer. Idempotent: the same report twice changes nothing the second time. */
export async function processDepositEvent(providerName: string, e: DepositEvent): Promise<void> {
  if (!(e.amount > 0)) throw new Error(`Deposit ${e.txHash} has no positive amount`);
  const toAddress = normalizeAddress(e.toAddress);
  const owner = await prisma.depositAddress.findFirst({
    where: { address: toAddress, network: { code: e.network } },
    select: { userId: true, symbol: true },
  });

  const key = { network_txHash_txIndex: { network: e.network, txHash: e.txHash, txIndex: e.txIndex } };
  const before = await prisma.blockchainDeposit.findUnique({ where: key });
  const deposit = await prisma.blockchainDeposit.upsert({
    where: key,
    create: {
      provider: providerName,
      network: e.network,
      symbol: e.symbol,
      txHash: e.txHash,
      txIndex: e.txIndex,
      toAddress,
      fromAddress: e.fromAddress ?? null,
      amount: e.amount,
      confirmations: e.confirmations,
      userId: owner?.userId ?? null,
    },
    // Confirmations only go up, unless the transfer left the chain.
    update: { confirmations: e.dropped ? e.confirmations : Math.max(before?.confirmations ?? 0, e.confirmations) },
  });

  if (e.dropped) return reverseDeposit(deposit.id);
  if (deposit.status !== "PENDING") return; // already decided

  if (!owner) return markException(deposit.id, "UNMATCHED", "Sent to an address that belongs to no customer.");
  if (owner.symbol !== e.symbol) {
    return markException(deposit.id, "WRONG_ASSET", `${e.symbol} arrived at the customer's ${owner.symbol} address on ${e.network}.`);
  }

  const needed = await requiredConfirmations(e.symbol, e.network);
  if (deposit.confirmations < needed) {
    if (!before) {
      void pushNotification(owner.userId, {
        title: `${e.amount} ${e.symbol} on its way`,
        body: `We've seen your deposit on ${e.network}. It needs ${needed} confirmations before the desk reviews it.`,
        href: "/dashboard/orders",
      });
    }
    return;
  }
  await matchConfirmedDeposit(deposit.id, owner.userId, e, needed);
}

async function markException(id: string, status: DepositStatus, note: string) {
  const { count } = await prisma.blockchainDeposit.updateMany({ where: { id, status: "PENDING" }, data: { status, note } });
  if (count > 0) {
    const d = await prisma.blockchainDeposit.findUniqueOrThrow({ where: { id } });
    void notifyAdmin("deposit.exception", { id, status, note, txHash: d.txHash, network: d.network, amount: d.amount });
  }
}

async function matchConfirmedDeposit(id: string, userId: string, e: DepositEvent, needed: number) {
  const cfg = depositConfig();
  const result = await prisma.$transaction(async (tx) => {
    const openOrders = await tx.cryptoOrder.findMany({
      where: {
        userId,
        side: "SELL",
        symbol: e.symbol,
        network: e.network,
        status: { in: ["AWAITING_DEPOSIT", "UNDER_REVIEW"] },
        // An order already paid by an earlier deposit is not paid again.
        deposits: { none: { status: { in: ["CREDITED", "UNDERPAID", "OVERPAID"] } } },
      },
      select: { id: true, reference: true, amountCrypto: true, createdAt: true, status: true, txHash: true },
    });
    const order = pickOrderForDeposit(openOrders, e.amount, cfg.amountTolerancePct);
    const match = order ? classifyAmount(order.amountCrypto, e.amount, cfg.amountTolerancePct) : null;
    const status: DepositStatus = !order ? "UNMATCHED" : match === "EXACT" ? "CREDITED" : match === "UNDER" ? "UNDERPAID" : "OVERPAID";
    const note = !order
      ? "No open sell order for this customer, asset and network."
      : match === "EXACT"
        ? null
        : `Order ${order.reference} expected ${order.amountCrypto} ${e.symbol}; ${e.amount} arrived.`;

    // Only the first delivery to get here decides; a concurrent one finds the status changed.
    const { count } = await tx.blockchainDeposit.updateMany({
      where: { id, status: "PENDING" },
      data: { status, note, orderId: order?.id ?? null, confirmedAt: new Date() },
    });
    if (count === 0 || !order) return { status, order: count === 0 ? null : order, note, applied: count > 0 };

    if (order.status === "AWAITING_DEPOSIT") {
      await tx.cryptoOrder.updateMany({
        where: { id: order.id, status: "AWAITING_DEPOSIT" },
        data: { status: "UNDER_REVIEW", ...(order.txHash ? {} : { txHash: e.txHash }) },
      });
    } else if (!order.txHash) {
      await tx.cryptoOrder.updateMany({ where: { id: order.id, txHash: null }, data: { txHash: e.txHash } });
    }
    return { status, order, note, applied: true };
  });

  if (!result.applied) return;
  if (result.status === "CREDITED" && result.order) {
    void pushNotification(userId, {
      title: `${e.amount} ${e.symbol} received`,
      body: `Your deposit for ${result.order.reference} has ${needed} confirmations. The desk is reviewing it now.`,
      href: "/dashboard/orders",
    });
    void notifyAdmin("deposit.credited", { reference: result.order.reference, amount: e.amount, symbol: e.symbol, txHash: e.txHash });
  } else {
    void notifyAdmin("deposit.exception", { id, status: result.status, note: result.note, txHash: e.txHash, amount: e.amount });
  }
}

/** A transfer the chain no longer has (reorganisation, or reversed by the provider). */
async function reverseDeposit(id: string) {
  const d = await prisma.blockchainDeposit.findUniqueOrThrow({ where: { id }, include: { order: { select: { id: true, reference: true, status: true, txHash: true } } } });
  if (d.status === "REVERSED" || d.status === "RESOLVED") return;
  await prisma.$transaction(async (tx) => {
    await tx.blockchainDeposit.update({
      where: { id },
      data: { status: "REVERSED", note: `Transfer left the chain after ${d.status === "PENDING" ? "being seen" : "being matched"}.` },
    });
    // Not paid out yet: put the order back to waiting for the deposit.
    if (d.order && d.order.status === "UNDER_REVIEW") {
      await tx.cryptoOrder.updateMany({
        where: { id: d.order.id, status: "UNDER_REVIEW" },
        data: { status: "AWAITING_DEPOSIT", ...(d.order.txHash === d.txHash ? { txHash: null } : {}) },
      });
    }
  });
  const paidAlready = d.order && !["AWAITING_DEPOSIT", "UNDER_REVIEW"].includes(d.order.status);
  void notifyAdmin(paidAlready ? "deposit.reversed_after_approval" : "deposit.reversed", {
    id,
    txHash: d.txHash,
    network: d.network,
    order: d.order?.reference ?? null,
    orderStatus: d.order?.status ?? null,
  });
}

// ---------------------------------------------------------------- desk

export async function listDeposits() {
  const [recent, exceptions] = await Promise.all([
    prisma.blockchainDeposit.findMany({ orderBy: { firstSeenAt: "desc" }, take: 20, include: { order: { select: { reference: true } } } }),
    prisma.blockchainDeposit.findMany({
      where: { status: { in: EXCEPTIONS } },
      orderBy: { firstSeenAt: "asc" },
      take: 50,
      include: { order: { select: { reference: true } } },
    }),
  ]);
  return { recent, exceptions, simulated: activeDepositProvider()?.name === "simulated" };
}

const resolveSchema = z.object({ id: z.string().min(1), note: z.string().trim().min(5, "Say what was done (at least 5 characters).").max(500) });

/** Closes an exception once a person has dealt with it (refunded, re-priced, attached by hand...). Audited. */
export async function resolveDeposit(admin: { id: string }, input: unknown): Promise<ServiceResult<null>> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const d = await prisma.blockchainDeposit.findUnique({ where: { id: parsed.data.id } });
  if (!d) return fail("Deposit not found.", 404);
  const { count } = await prisma.blockchainDeposit.updateMany({
    where: { id: d.id, status: { in: EXCEPTIONS } },
    data: { status: "RESOLVED", note: `${d.note ? `${d.note} ` : ""}Resolved: ${parsed.data.note}`, resolvedAt: new Date(), resolvedBy: admin.id },
  });
  if (count === 0) return fail("Only an exception can be resolved.", 409);
  await writeAudit("admin.deposit_resolve", { userId: admin.id, meta: { id: d.id, txHash: d.txHash, from: d.status, note: parsed.data.note } });
  return ok(null, "Deposit marked resolved.");
}

// ---------------------------------------------------------------- simulation (never in production)

const simulateSchema = z.object({
  toAddress: z.string().trim().min(10, "Enter the customer's deposit address."),
  network: z.string().trim().min(2).transform((s) => s.toUpperCase()),
  symbol: z.string().trim().min(2).transform((s) => s.toUpperCase()),
  amount: z.coerce.number().positive("Enter the amount sent."),
  confirmations: z.coerce.number().int().min(0).max(10_000),
  txHash: z.string().trim().max(128).optional().or(z.literal("").transform(() => undefined)),
  dropped: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).optional(),
});

/**
 * Pretends the simulated provider saw a transfer, by sending it a signed webhook through the same
 * path a real provider would use. Send the same transaction again with more confirmations to
 * watch it confirm, or with "dropped" to simulate a reorganisation.
 */
export async function simulateDeposit(admin: { id: string }, input: unknown): Promise<ServiceResult<{ txHash: string; result: WebhookResult }>> {
  if (!simulatedDepositsAllowed()) return fail("Simulated deposits are switched off in production.", 403);
  const parsed = simulateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const d = parsed.data;
  const txHash = d.txHash ?? `sim${randomBytes(30).toString("hex")}`;
  const raw = JSON.stringify({
    events: [
      {
        eventId: `sim-${txHash}-${d.confirmations}-${d.dropped ? "drop" : "conf"}-${randomBytes(3).toString("hex")}`,
        network: d.network,
        symbol: d.symbol,
        txHash,
        txIndex: "0",
        toAddress: d.toAddress,
        fromAddress: null,
        amount: d.amount,
        confirmations: d.confirmations,
        dropped: d.dropped ?? false,
      },
    ],
  });
  const result = await handleDepositWebhook("simulated", raw, new Headers(signSimulatedWebhook(raw)));
  await writeAudit("admin.deposit_simulate", { userId: admin.id, meta: { txHash, network: d.network, symbol: d.symbol, amount: d.amount, confirmations: d.confirmations, dropped: d.dropped ?? false } });
  if (result.status !== 200) return fail(String(result.body.error ?? "Simulation failed."), result.status);
  return ok({ txHash, result }, `Simulated ${d.amount} ${d.symbol} on ${d.network} with ${d.confirmations} confirmations. Transaction ${txHash.slice(0, 14)}…`);
}
