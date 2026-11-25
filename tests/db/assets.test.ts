import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { addAssetNetwork, updateAssetNetwork } from "@/lib/services/assets";
import { createCryptoBuyOrder, createCryptoSellOrder } from "@/lib/services/trades";
import { createQuote } from "@/lib/services/quotes";
import * as mobile from "@/app/api/mobile/route";
import * as assetsRoute from "@/app/api/v1/assets/route";
import { makeAdmin, makeCustomer, settle } from "../helpers/fixtures";

const ctx = { ip: "127.0.0.1" };
const TRON_ADDRESS = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
const EVM_ADDRESS = "0x52908400098527886E0F7030069857D2E4169EE7";
const ids: Record<string, string> = {};

const netId = async (code: string) => (await prisma.blockchainNetwork.findUniqueOrThrow({ where: { code } })).id;
const row = (symbol: string, code: string) =>
  prisma.assetNetwork.findFirstOrThrow({ where: { symbol, network: { code } }, include: { network: true } });

beforeAll(async () => {
  await prisma.rate.createMany({
    data: [
      { kind: "CRYPTO", symbol: "USDT", displayName: "Tether", sellRateNgn: 1500, buyRateNgn: 1520, minAmount: 1 },
      { kind: "CRYPTO", symbol: "SOL", displayName: "Solana", sellRateNgn: 300_000, buyRateNgn: 305_000, minAmount: 0.1 },
    ],
  });
  // USDT on two networks: TRC20 (default) and BEP20 (sells only).
  await prisma.assetNetwork.createMany({
    data: [
      { symbol: "USDT", networkId: await netId("TRC20"), depositAddress: "TDeskTronDepositAddress00000000001", confirmations: 20, isDefault: true },
      { symbol: "USDT", networkId: await netId("BEP20"), depositAddress: "0x00000000000000000000000000000000000000b5", confirmations: 15, withdrawalsEnabled: false },
    ],
  });
  ids.trc20 = (await row("USDT", "TRC20")).id;
  ids.bep20 = (await row("USDT", "BEP20")).id;
});

describe("the four networks the migration installs", () => {
  it("are present with formats, explorers and confirmation defaults", async () => {
    const networks = await prisma.blockchainNetwork.findMany({ orderBy: { code: "asc" } });
    expect(networks.map((n) => [n.code, n.defaultConfirmations, !!n.explorerTxUrl])).toEqual([
      ["BEP20", 15, true],
      ["BTC", 2, true],
      ["ERC20", 12, true],
      ["TRC20", 20, true],
    ]);
  });
});

describe("orders use the registry", () => {
  it("sends a sell to the default network's deposit address when no network is named", async () => {
    const user = await makeCustomer();
    const res = await createCryptoSellOrder(user, { symbol: "USDT", amountCrypto: 10, payoutMethod: "WALLET" }, ctx);
    expect(res.ok && res.data).toMatchObject({ network: "TRC20", depositAddress: "TDeskTronDepositAddress00000000001" });
    expect(res.ok && res.message).toMatch(/on TRC20 only/);
    await settle();
  });

  it("sends a sell to the named network's own address", async () => {
    const user = await makeCustomer();
    const res = await createCryptoSellOrder(user, { symbol: "USDT", network: "bep20", amountCrypto: 10, payoutMethod: "WALLET" }, ctx);
    expect(res.ok && res.data).toMatchObject({ network: "BEP20", depositAddress: "0x00000000000000000000000000000000000000b5" });
    await settle();
  });

  it("refuses a buy on a network the desk does not send out on", async () => {
    const user = await makeCustomer({ balanceNgn: 100_000 });
    const res = await createCryptoBuyOrder(user, { symbol: "USDT", network: "BEP20", amountCrypto: 10, userReceiveAddress: EVM_ADDRESS, payFrom: "WALLET" }, ctx);
    expect(res).toMatchObject({ ok: false, status: 422 });
    expect(!res.ok && res.error).toMatch(/Available: TRC20/);
  });

  it("checks the customer's address against the order's network, not the asset", async () => {
    const user = await makeCustomer({ balanceNgn: 100_000 });
    const wrong = await createCryptoBuyOrder(user, { symbol: "USDT", amountCrypto: 10, userReceiveAddress: EVM_ADDRESS, payFrom: "WALLET" }, ctx);
    expect(wrong).toMatchObject({ ok: false, status: 422 });
    expect(!wrong.ok && wrong.error).toMatch(/TRC20/);

    const right = await createCryptoBuyOrder(user, { symbol: "USDT", amountCrypto: 10, userReceiveAddress: TRON_ADDRESS, payFrom: "WALLET" }, ctx);
    expect(right.ok && right.data.order.network).toBe("TRC20");
    await settle();
  });

  it("treats an asset with a rate but no network as not tradable, for orders and quotes", async () => {
    const user = await makeCustomer();
    expect(await createCryptoSellOrder(user, { symbol: "SOL", amountCrypto: 1, payoutMethod: "WALLET" }, ctx)).toMatchObject({ ok: false });
    expect(await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "SOL", amount: 1 }, ctx)).toMatchObject({ ok: false });
  });

  it("stops new orders the moment a network is switched off", async () => {
    const user = await makeCustomer();
    await prisma.blockchainNetwork.update({ where: { code: "BEP20" }, data: { isActive: false } });
    try {
      const res = await createCryptoSellOrder(user, { symbol: "USDT", network: "BEP20", amountCrypto: 10, payoutMethod: "WALLET" }, ctx);
      expect(res).toMatchObject({ ok: false, status: 422 });
    } finally {
      await prisma.blockchainNetwork.update({ where: { code: "BEP20" }, data: { isActive: true } });
    }
  });
});

describe("admin changes", () => {
  const base = { depositMemo: "", confirmations: "20", depositsEnabled: "on", withdrawalsEnabled: "on", isDefault: "on", note: "" };

  it("refuses a deposit address that does not fit the network", async () => {
    const admin = await makeAdmin();
    const res = await updateAssetNetwork(admin, { ...base, id: ids.trc20, depositAddress: EVM_ADDRESS });
    expect(res).toMatchObject({ ok: false, status: 422 });
    expect((await row("USDT", "TRC20")).depositAddress).toBe("TDeskTronDepositAddress00000000001");
  });

  it("saves a valid change and audits the old and new address", async () => {
    const admin = await makeAdmin();
    const res = await updateAssetNetwork(admin, { ...base, id: ids.trc20, depositAddress: TRON_ADDRESS, confirmations: "25" });
    expect(res.ok).toBe(true);
    expect(await row("USDT", "TRC20")).toMatchObject({ depositAddress: TRON_ADDRESS, confirmations: 25 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { userId: admin.id, action: "admin.asset_network_update" } });
    expect(audit.meta).toContain("TDeskTronDepositAddress00000000001");
    expect(audit.meta).toContain(TRON_ADDRESS);
  });

  it("moves the default instead of leaving an asset with two, or none", async () => {
    const admin = await makeAdmin();
    const bep = await row("USDT", "BEP20");
    // Turning the default off directly is refused.
    expect(await updateAssetNetwork(admin, { ...base, id: ids.trc20, depositAddress: TRON_ADDRESS, isDefault: "" })).toMatchObject({ ok: false, status: 409 });

    expect((await updateAssetNetwork(admin, { ...base, id: bep.id, depositAddress: bep.depositAddress, confirmations: "15", withdrawalsEnabled: "" })).ok).toBe(true);
    expect((await row("USDT", "BEP20")).isDefault).toBe(true);
    expect((await row("USDT", "TRC20")).isDefault).toBe(false);
    expect(await prisma.assetNetwork.count({ where: { symbol: "USDT", isDefault: true } })).toBe(1);

    // Put it back for the rest of the file.
    expect((await updateAssetNetwork(admin, { ...base, id: ids.trc20, depositAddress: TRON_ADDRESS })).ok).toBe(true);
    expect((await row("USDT", "TRC20")).isDefault).toBe(true);
  });

  it("adds an asset on a new network switched off, and refuses a duplicate", async () => {
    const admin = await makeAdmin();
    const erc20 = await netId("ERC20");
    const res = await addAssetNetwork(admin, { symbol: "usdt", networkId: erc20, depositAddress: EVM_ADDRESS });
    expect(res.ok).toBe(true);
    expect(await row("USDT", "ERC20")).toMatchObject({ depositsEnabled: false, withdrawalsEnabled: false, isDefault: false, confirmations: 12 });

    expect(await addAssetNetwork(admin, { symbol: "USDT", networkId: erc20, depositAddress: EVM_ADDRESS })).toMatchObject({ ok: false, status: 409 });
    // Switched off means customers cannot use it yet.
    const user = await makeCustomer();
    expect(await createCryptoSellOrder(user, { symbol: "USDT", network: "ERC20", amountCrypto: 10, payoutMethod: "WALLET" }, ctx)).toMatchObject({ ok: false });
  });

  it("refuses an asset that has no rate, and a bad address for the network", async () => {
    const admin = await makeAdmin();
    expect(await addAssetNetwork(admin, { symbol: "DOGE", networkId: await netId("BEP20"), depositAddress: EVM_ADDRESS })).toMatchObject({ ok: false, status: 422 });
    expect(await addAssetNetwork(admin, { symbol: "SOL", networkId: await netId("TRC20"), depositAddress: EVM_ADDRESS })).toMatchObject({ ok: false, status: 422 });
  });
});

describe("what clients see", () => {
  it("the existing mobile endpoint still gets one deposit wallet per asset, in the old shape", async () => {
    const user = await makeCustomer();
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const token = await createSession({ id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, role: u.role }, { setCookie: false });
    const res = await mobile.GET(new Request("http://api.test/api/mobile", { headers: { authorization: `Bearer ${token}` } }));
    const json = (await res.json()) as { wallets: Array<Record<string, unknown>> };

    const usdt = json.wallets.filter((w) => w.symbol === "USDT");
    expect(usdt).toHaveLength(1);
    expect(Object.keys(usdt[0]).sort()).toEqual(["address", "network", "note", "symbol"]);
    expect(usdt[0]).toMatchObject({ network: "TRC20", address: TRON_ADDRESS });
  });

  it("v1 lists every usable network per asset, without deposit addresses", async () => {
    const res = await assetsRoute.GET(new Request("http://api.test/api/v1/assets"), { params: Promise.resolve({}) });
    const json = (await res.json()) as { data: Array<{ symbol: string; network: string; networks: Array<Record<string, unknown>> }> };
    const usdt = json.data.find((a) => a.symbol === "USDT")!;

    expect(usdt.network).toBe("TRC20");
    expect(usdt.networks.map((n) => [n.network, n.sell, n.buy])).toEqual([
      ["TRC20", true, true],
      ["BEP20", true, false],
    ]);
    expect(JSON.stringify(json)).not.toMatch(/depositAddress|TQn9Y2kh/);
    // An asset with a rate but no network is not offered.
    expect(json.data.find((a) => a.symbol === "SOL")).toBeUndefined();
  });
});

describe("assets with no network", () => {
  it("refuses an asset that has no rate at all, as before", async () => {
    const user = await makeCustomer();
    const res = await createCryptoSellOrder(user, { symbol: "DOGE", amountCrypto: 1, payoutMethod: "WALLET" }, ctx);
    expect(res).toMatchObject({ ok: false });
    expect(await prisma.cryptoOrder.count({ where: { userId: user.id } })).toBe(0);
  });
});
