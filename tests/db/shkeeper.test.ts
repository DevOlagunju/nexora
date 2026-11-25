import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

import { prisma } from "@/lib/db";
import { signShkeeperCallback } from "@/lib/deposits/shkeeper";
import { createCryptoSellOrder } from "@/lib/services/trades";
import * as webhookRoute from "@/app/api/v1/webhooks/[provider]/route";
import { makeCustomer, settle } from "../helpers/fixtures";

const ctx = { ip: "127.0.0.1" };
const KEY = "test-shkeeper-api-key";
const SHKEEPER = "https://pay.test";
const ADDRESSES = Array.from({ length: 20 }, (_, i) => `TShkeeperTestAddress${String(i).padStart(14, "0")}`);

/** A stand-in SHKeeper server: issues addresses and answers invoice look-ups from `txs`. */
const server = {
  up: true,
  issued: new Map<string, string>(),
  txs: new Map<string, Array<{ txid: string; status: string; amount: string; addr: string; crypto: string }>>(),
  calls: [] as Array<{ url: string; method: string; body: unknown; key: string | null }>,
};

const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  server.calls.push({ url, method: init?.method ?? "GET", body, key: headers.get("x-shkeeper-api-key") });
  if (!server.up) throw new TypeError("fetch failed");
  if (headers.get("x-shkeeper-api-key") !== KEY) return Response.json({ status: "error", message: "bad key" }, { status: 401 });

  const create = url.match(/\/api\/v1\/([^/]+)\/payment_request$/);
  if (create) {
    const id = String(body.external_id);
    if (!server.issued.has(id)) server.issued.set(id, ADDRESSES[server.issued.size]);
    return Response.json({ status: "success", wallet: server.issued.get(id), amount: "1", exchange_rate: "1", display_name: "USDT", id: 1, recalculate_after: 0 });
  }
  const invoice = url.match(/\/api\/v1\/invoices\/(.+)$/);
  if (invoice) {
    const id = decodeURIComponent(invoice[1]);
    return Response.json({ status: "success", invoices: [{ external_id: id, status: "PAID", txs: server.txs.get(id) ?? [] }] });
  }
  return Response.json({ status: "error" }, { status: 404 });
});

/** Sends a callback the way SHKeeper does, through the real webhook route. */
async function callback(externalId: string, addr: string, txs: Array<{ txid: string; amount: string }>, opts: { secret?: string } = {}) {
  const raw = JSON.stringify({
    external_id: externalId,
    crypto: "USDT",
    addr,
    fiat: "USD",
    paid: true,
    status: "PAID",
    transactions: txs.map((t) => ({ txid: t.txid, date: "2026-11-25 10:00:00", amount_crypto: t.amount, amount_fiat: t.amount, trigger: true, crypto: "USDT" })),
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await webhookRoute.POST(
    new Request("http://api.test/api/v1/webhooks/shkeeper", {
      method: "POST",
      body: raw,
      headers: { "content-type": "application/json", "X-Shkeeper-Timestamp": ts, "X-Shkeeper-Signature": signShkeeperCallback(opts.secret ?? KEY, ts, raw) },
    }),
    { params: Promise.resolve({ provider: "shkeeper" }) },
  );
  return res.status;
}

async function sellOrder(userId: string, amountCrypto: number) {
  return createCryptoSellOrder({ id: userId, email: "x@example.test" }, { symbol: "USDT", amountCrypto, payoutMethod: "WALLET" }, ctx);
}

beforeAll(async () => {
  vi.stubEnv("DEPOSIT_PROVIDER", "shkeeper");
  vi.stubEnv("SHKEEPER_URL", SHKEEPER);
  vi.stubEnv("SHKEEPER_API_KEY", KEY);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://nexora.test");
  vi.stubGlobal("fetch", fakeFetch);
  await prisma.rate.create({ data: { kind: "CRYPTO", symbol: "USDT", displayName: "Tether", sellRateNgn: 1_485, buyRateNgn: 1_515, minAmount: 1 } });
  const n = await prisma.blockchainNetwork.findUniqueOrThrow({ where: { code: "TRC20" } });
  await prisma.assetNetwork.create({ data: { symbol: "USDT", networkId: n.id, depositAddress: "TDeskSharedDepositAddress000000001", confirmations: 20, isDefault: true } });
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  server.up = true;
  server.calls.length = 0;
});

describe("SHKeeper deposit addresses", () => {
  it("asks SHKeeper for the customer's own address once, with the key and callback URL", async () => {
    const user = await makeCustomer();
    const first = await sellOrder(user.id, 100);
    const second = await sellOrder(user.id, 50);
    expect(first.ok && first.data.depositAddress).toBe(ADDRESSES[0]);
    expect(second.ok && second.data.depositAddress).toBe(ADDRESSES[0]);

    const creates = server.calls.filter((c) => c.url.endsWith("/payment_request"));
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      url: `${SHKEEPER}/api/v1/USDT/payment_request`,
      method: "POST",
      key: KEY,
      body: { external_id: `nexora:${user.id}:USDT:TRC20`, fiat: "USD", callback_url: "https://nexora.test/api/v1/webhooks/shkeeper" },
    });
    expect(await prisma.depositAddress.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ provider: "shkeeper", providerRef: `nexora:${user.id}:USDT:TRC20` });
    await settle();
  });

  it("refuses the order, rather than show an unwatched address, when SHKeeper is down", async () => {
    const user = await makeCustomer();
    server.up = false;
    const res = await sellOrder(user.id, 100);
    expect(res).toMatchObject({ ok: false, status: 503 });
    expect(await prisma.cryptoOrder.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("SHKeeper deposit callbacks", () => {
  it("credit the order only once SHKeeper's own API shows the transaction CONFIRMED", async () => {
    const user = await makeCustomer();
    const placed = await sellOrder(user.id, 100);
    if (!placed.ok) throw new Error(placed.error);
    const ext = `nexora:${user.id}:USDT:TRC20`;
    const addr = placed.data.depositAddress!;

    // SHKeeper calls back before its API shows the transaction as confirmed: refused, so it retries.
    server.txs.set(ext, [{ txid: "tx-a", status: "UNCONFIRMED", amount: "100", addr, crypto: "USDT" }]);
    expect(await callback(ext, addr, [{ txid: "tx-a", amount: "100" }])).toBe(500);
    expect(await prisma.blockchainDeposit.count({ where: { txHash: "tx-a" } })).toBe(0);

    // A minute later it is confirmed.
    server.txs.set(ext, [{ txid: "tx-a", status: "CONFIRMED", amount: "100", addr, crypto: "USDT" }]);
    expect(await callback(ext, addr, [{ txid: "tx-a", amount: "100" }])).toBe(202);
    expect(await prisma.blockchainDeposit.findFirstOrThrow({ where: { txHash: "tx-a" } })).toMatchObject({
      provider: "shkeeper",
      status: "CREDITED",
      orderId: placed.data.id,
      confirmations: 20,
      userId: user.id,
    });
    expect((await prisma.cryptoOrder.findUniqueOrThrow({ where: { id: placed.data.id } })).status).toBe("UNDER_REVIEW");

    // SHKeeper repeats earlier transactions in later callbacks; they are not applied twice.
    expect(await callback(ext, addr, [{ txid: "tx-a", amount: "100" }])).toBe(202);
    expect(await prisma.blockchainDeposit.count({ where: { txHash: "tx-a" } })).toBe(1);
    await settle();
  });

  it("use SHKeeper's own amount, not the callback's", async () => {
    const user = await makeCustomer();
    const placed = await sellOrder(user.id, 100);
    if (!placed.ok) throw new Error(placed.error);
    const ext = `nexora:${user.id}:USDT:TRC20`;
    const addr = placed.data.depositAddress!;
    server.txs.set(ext, [{ txid: "tx-b", status: "CONFIRMED", amount: "40", addr, crypto: "USDT" }]);

    expect(await callback(ext, addr, [{ txid: "tx-b", amount: "100" }])).toBe(202);
    expect(await prisma.blockchainDeposit.findFirstOrThrow({ where: { txHash: "tx-b" } })).toMatchObject({ amount: 40, status: "UNDERPAID" });
    await settle();
  });

  it("ignore a transaction SHKeeper does not know, and a callback with a bad signature", async () => {
    const user = await makeCustomer();
    const placed = await sellOrder(user.id, 100);
    if (!placed.ok) throw new Error(placed.error);
    const ext = `nexora:${user.id}:USDT:TRC20`;
    const addr = placed.data.depositAddress!;

    expect(await callback(ext, addr, [{ txid: "tx-forged", amount: "100" }])).toBe(500);
    expect(await callback(ext, addr, [{ txid: "tx-c", amount: "100" }], { secret: "wrong" })).toBe(401);
    expect(await prisma.blockchainDeposit.count({ where: { txHash: { in: ["tx-forged", "tx-c"] } } })).toBe(0);
    // The forged callback is kept for investigation.
    expect(await prisma.webhookEvent.findFirstOrThrow({ where: { provider: "shkeeper", eventId: "USDT:tx-c" } })).toMatchObject({ signatureOk: false, processedAt: null });
    expect((await prisma.cryptoOrder.findUniqueOrThrow({ where: { id: placed.data.id } })).status).toBe("AWAITING_DEPOSIT");
    await settle();
  });
});
