import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { signSimulatedWebhook } from "@/lib/deposits/provider";
import { customerDepositAddress, handleDepositWebhook, resolveDeposit, simulateDeposit } from "@/lib/services/deposits";
import { createCryptoSellOrder } from "@/lib/services/trades";
import * as webhookRoute from "@/app/api/v1/webhooks/[provider]/route";
import * as mobile from "@/app/api/mobile/route";
import { makeAdmin, makeCustomer, settle } from "../helpers/fixtures";

const ctx = { ip: "127.0.0.1" };
let tron: { id: string; code: string };
let seq = 0;

/** What a provider would send: one signed webhook with one transfer. */
function webhook(e: { toAddress: string; amount: number; confirmations: number; txHash?: string; symbol?: string; network?: string; dropped?: boolean }) {
  const txHash = e.txHash ?? `tx${Date.now().toString(36)}${seq++}`;
  const raw = JSON.stringify({
    events: [
      {
        eventId: `ev-${txHash}-${e.confirmations}-${e.dropped ? "d" : "c"}-${seq++}`,
        network: e.network ?? "TRC20",
        symbol: e.symbol ?? "USDT",
        txHash,
        txIndex: "0",
        toAddress: e.toAddress,
        amount: e.amount,
        confirmations: e.confirmations,
        dropped: e.dropped ?? false,
      },
    ],
  });
  return { txHash, raw, send: () => handleDepositWebhook("simulated", raw, new Headers(signSimulatedWebhook(raw))) };
}

async function sellOrder(userId: string, amountCrypto: number) {
  const user = { id: userId, email: "x@example.test" };
  const res = await createCryptoSellOrder(user, { symbol: "USDT", amountCrypto, payoutMethod: "WALLET" }, ctx);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

const depositFor = (txHash: string) => prisma.blockchainDeposit.findFirstOrThrow({ where: { txHash } });
const orderNow = (id: string) => prisma.cryptoOrder.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  process.env.DEPOSIT_PROVIDER = "simulated";
  await prisma.rate.create({ data: { kind: "CRYPTO", symbol: "USDT", displayName: "Tether", sellRateNgn: 1_485, buyRateNgn: 1_515, minAmount: 1 } });
  const n = await prisma.blockchainNetwork.findUniqueOrThrow({ where: { code: "TRC20" } });
  tron = { id: n.id, code: n.code };
  await prisma.assetNetwork.create({ data: { symbol: "USDT", networkId: n.id, depositAddress: "TDeskSharedDepositAddress000000001", confirmations: 20, isDefault: true } });
});

afterAll(() => {
  process.env.DEPOSIT_PROVIDER = "none";
});

describe("customer deposit addresses", () => {
  it("each customer gets their own address, the same one every time, shaped for the network", async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    const first = await customerDepositAddress(a.id, "USDT", tron);
    const again = await customerDepositAddress(a.id, "USDT", tron);
    const other = await customerDepositAddress(b.id, "USDT", tron);

    expect(first?.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(again?.address).toBe(first?.address);
    expect(other?.address).not.toBe(first?.address);
  });

  it("is used for sell orders and shown in the app instead of the shared desk address", async () => {
    const user = await makeCustomer();
    const own = await customerDepositAddress(user.id, "USDT", tron);
    const order = await sellOrder(user.id, 100);
    expect(order.depositAddress).toBe(own?.address);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const token = await createSession({ id: row.id, email: row.email, fullName: row.fullName, phone: row.phone, role: row.role }, { setCookie: false });
    const res = await mobile.GET(new Request("http://api.test/api/mobile", { headers: { authorization: `Bearer ${token}` } }));
    const json = (await res.json()) as { wallets: Array<{ symbol: string; address: string }> };
    expect(json.wallets.find((w) => w.symbol === "USDT")?.address).toBe(own?.address);
    await settle();
  });
});

describe("a deposit arriving", () => {
  it("waits for enough confirmations, then pays the customer's order and sends it to the desk", async () => {
    const user = await makeCustomer();
    const order = await sellOrder(user.id, 100);
    const w = webhook({ toAddress: order.depositAddress!, amount: 100, confirmations: 3 });

    expect((await w.send()).status).toBe(200);
    expect(await depositFor(w.txHash)).toMatchObject({ status: "PENDING", confirmations: 3, orderId: null, userId: user.id });
    expect((await orderNow(order.id)).status).toBe("AWAITING_DEPOSIT");

    await webhook({ toAddress: order.depositAddress!, amount: 100, confirmations: 20, txHash: w.txHash }).send();
    expect(await depositFor(w.txHash)).toMatchObject({ status: "CREDITED", confirmations: 20, orderId: order.id });
    expect(await orderNow(order.id)).toMatchObject({ status: "UNDER_REVIEW", txHash: w.txHash });
    await settle();
  });

  it("does nothing new when the same webhook is delivered again, or a stale lower count arrives", async () => {
    const user = await makeCustomer();
    const order = await sellOrder(user.id, 50);
    const w = webhook({ toAddress: order.depositAddress!, amount: 50, confirmations: 25 });
    await w.send();
    const repeat = await handleDepositWebhook("simulated", w.raw, new Headers(signSimulatedWebhook(w.raw)));
    expect(repeat.body).toMatchObject({ processed: 0, duplicates: 1 });

    await webhook({ toAddress: order.depositAddress!, amount: 50, confirmations: 2, txHash: w.txHash }).send();
    expect(await depositFor(w.txHash)).toMatchObject({ status: "CREDITED", confirmations: 25 });
    expect(await prisma.blockchainDeposit.count({ where: { txHash: w.txHash } })).toBe(1);
    await settle();
  });

  it("pays the order whose amount matches when the customer has several open", async () => {
    const user = await makeCustomer();
    const older = await sellOrder(user.id, 100);
    const matching = await sellOrder(user.id, 250);
    const w = webhook({ toAddress: older.depositAddress!, amount: 250, confirmations: 20 });
    await w.send();
    expect((await depositFor(w.txHash)).orderId).toBe(matching.id);
    expect((await orderNow(older.id)).status).toBe("AWAITING_DEPOSIT");
    await settle();
  });

  it("flags a short or excess deposit for a person, while still sending the order to the desk", async () => {
    const user = await makeCustomer();
    const order = await sellOrder(user.id, 100);
    const short = webhook({ toAddress: order.depositAddress!, amount: 90, confirmations: 20 });
    await short.send();
    expect(await depositFor(short.txHash)).toMatchObject({ status: "UNDERPAID", orderId: order.id });
    expect((await depositFor(short.txHash)).note).toMatch(/expected 100 USDT; 90 arrived/);
    expect((await orderNow(order.id)).status).toBe("UNDER_REVIEW");

    const other = await makeCustomer();
    const second = await sellOrder(other.id, 100);
    const over = webhook({ toAddress: second.depositAddress!, amount: 150, confirmations: 20 });
    await over.send();
    expect((await depositFor(over.txHash)).status).toBe("OVERPAID");
    await settle();
  });

  it("never pays an order twice: a second deposit to the same customer with no other open order is unmatched", async () => {
    const user = await makeCustomer();
    const order = await sellOrder(user.id, 100);
    await webhook({ toAddress: order.depositAddress!, amount: 100, confirmations: 20 }).send();
    const extra = webhook({ toAddress: order.depositAddress!, amount: 100, confirmations: 20 });
    await extra.send();
    expect(await depositFor(extra.txHash)).toMatchObject({ status: "UNMATCHED", orderId: null, userId: user.id });
    await settle();
  });

  it("flags an address that belongs to nobody, and the wrong asset sent to an address", async () => {
    const stray = webhook({ toAddress: "TNobodysAddress0000000000000000001", amount: 10, confirmations: 20 });
    await stray.send();
    expect(await depositFor(stray.txHash)).toMatchObject({ status: "UNMATCHED", userId: null });

    const user = await makeCustomer();
    const own = await customerDepositAddress(user.id, "USDT", tron);
    const wrong = webhook({ toAddress: own!.address, amount: 10, confirmations: 20, symbol: "USDC" });
    await wrong.send();
    expect(await depositFor(wrong.txHash)).toMatchObject({ status: "WRONG_ASSET" });
  });

  it("puts the order back to waiting when a matched transfer leaves the chain", async () => {
    const user = await makeCustomer();
    const order = await sellOrder(user.id, 100);
    const w = webhook({ toAddress: order.depositAddress!, amount: 100, confirmations: 20 });
    await w.send();
    expect((await orderNow(order.id)).status).toBe("UNDER_REVIEW");

    await webhook({ toAddress: order.depositAddress!, amount: 100, confirmations: 0, txHash: w.txHash, dropped: true }).send();
    expect((await depositFor(w.txHash)).status).toBe("REVERSED");
    expect(await orderNow(order.id)).toMatchObject({ status: "AWAITING_DEPOSIT", txHash: null });
    await settle();
  });
});

describe("webhook safety", () => {
  it("keeps an unsigned webhook for investigation and never acts on it", async () => {
    const user = await makeCustomer();
    const order = await sellOrder(user.id, 100);
    const forged = webhook({ toAddress: order.depositAddress!, amount: 100, confirmations: 50 });
    const res = await handleDepositWebhook("simulated", forged.raw, new Headers({ "x-simulated-signature": "0".repeat(64) }));

    expect(res.status).toBe(401);
    expect(await prisma.blockchainDeposit.count({ where: { txHash: forged.txHash } })).toBe(0);
    expect((await orderNow(order.id)).status).toBe("AWAITING_DEPOSIT");
    const stored = await prisma.webhookEvent.findFirstOrThrow({ where: { payload: { contains: forged.txHash } } });
    expect(stored).toMatchObject({ signatureOk: false, processedAt: null });
  });

  it("reaches the service through the public webhook URL, and refuses unknown providers", async () => {
    const user = await makeCustomer();
    const order = await sellOrder(user.id, 100);
    const w = webhook({ toAddress: order.depositAddress!, amount: 100, confirmations: 20 });
    const call = (provider: string, headers: Record<string, string>) =>
      webhookRoute.POST(new Request(`http://api.test/api/v1/webhooks/${provider}`, { method: "POST", headers, body: w.raw }), {
        params: Promise.resolve({ provider }),
      });

    expect((await call("simulated", signSimulatedWebhook(w.raw))).status).toBe(200);
    expect((await depositFor(w.txHash)).status).toBe("CREDITED");
    expect((await call("someone-else", signSimulatedWebhook(w.raw))).status).toBe(404);
    await settle();
  });

  it("the simulated provider does not exist in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const w = webhook({ toAddress: "TAnything000000000000000000000001", amount: 1, confirmations: 99 });
      expect((await w.send()).status).toBe(404);
      const admin = await makeAdmin();
      expect(await simulateDeposit(admin, { toAddress: "TAnything000000000000000000000001", network: "TRC20", symbol: "USDT", amount: "1", confirmations: "99" })).toMatchObject({
        ok: false,
        status: 403,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("the desk", () => {
  it("simulates a deposit end to end, and resolves an exception with a note", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const order = await sellOrder(user.id, 100);

    const sim = await simulateDeposit(admin, { toAddress: order.depositAddress!, network: "trc20", symbol: "usdt", amount: "80", confirmations: "20" });
    expect(sim.ok).toBe(true);
    if (!sim.ok) return;
    const d = await depositFor(sim.data.txHash);
    expect(d.status).toBe("UNDERPAID");

    expect(await resolveDeposit(admin, { id: d.id, note: "ok" })).toMatchObject({ ok: false });
    expect((await resolveDeposit(admin, { id: d.id, note: "Customer sent the rest; repriced the order." })).ok).toBe(true);
    expect(await depositFor(sim.data.txHash)).toMatchObject({ status: "RESOLVED", resolvedBy: admin.id });
    expect(await resolveDeposit(admin, { id: d.id, note: "Second time should fail." })).toMatchObject({ ok: false, status: 409 });
    await settle();
  });
});
