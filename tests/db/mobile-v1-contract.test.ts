import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import * as quotes from "@/app/api/v1/quotes/route";
import * as cryptoOrders from "@/app/api/v1/crypto/orders/route";
import * as giftOrders from "@/app/api/v1/giftcards/orders/route";
import * as assets from "@/app/api/v1/assets/route";
import * as giftBrands from "@/app/api/v1/giftcards/brands/route";
import { balanceOf, makeCustomer, settle } from "../helpers/fixtures";

/**
 * The exact requests nexora-mobile sends since it moved to /api/v1 (lib/api.ts, lib/quotes.ts,
 * app/sell-crypto.tsx, app/buy-crypto.tsx, app/sell-giftcard.tsx). If the API changes shape,
 * this fails before the app does.
 */

type Handler = (request: Request, route: { params: Promise<Record<string, never>> }) => Promise<Response>;
let ip = 1;
async function call(handler: Handler, token: string | null, body?: unknown, key?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.8.0.${ip++ % 250}` };
  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["idempotency-key"] = key;
  const res = await handler(
    new Request("http://api.test/api/v1/x", { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, headers: res.headers, json: (await res.json()) as any };
}

async function appUser(balanceNgn = 0) {
  const c = await makeCustomer({ balanceNgn });
  const u = await prisma.user.findUniqueOrThrow({ where: { id: c.id } });
  const token = await createSession({ id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, role: u.role }, { setCookie: false });
  return { ...c, token };
}

/** Same shape as lib/api.ts newIdempotencyKey() in the app. */
const appKey = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14).padEnd(12, "0")}`;

beforeAll(async () => {
  await prisma.rate.createMany({
    data: [
      { kind: "CRYPTO", symbol: "USDT", displayName: "Tether", sellRateNgn: 1500, buyRateNgn: 1520, minAmount: 1 },
      { kind: "GIFTCARD", symbol: "AMAZON", displayName: "Amazon", sellRateNgn: 1200, buyRateNgn: 0, minAmount: 25, maxAmount: 500 },
    ],
  });
  const tron = await prisma.blockchainNetwork.findUniqueOrThrow({ where: { code: "TRC20" } });
  await prisma.assetNetwork.create({
    data: { symbol: "USDT", networkId: tron.id, depositAddress: "TDeskTronDepositAddress00000000001", confirmations: 20, isDefault: true },
  });
  await prisma.giftCardRate.createMany({
    data: [
      { brand: "AMAZON", country: "US", cardType: "ECODE", rateNgn: 1200, minFaceUsd: 25, maxFaceUsd: 500, isDefault: true },
      { brand: "AMAZON", country: "GB", cardType: "PHYSICAL", rateNgn: 1000, minFaceUsd: 25, maxFaceUsd: 500 },
    ],
  });
});

describe("what the app reads", () => {
  it("assets: symbol, displayName, limits and networks with sell/buy, as components/trade.tsx expects", async () => {
    const res = await call(assets.GET as unknown as Handler, null);
    const usdt = res.json.data.find((a: { symbol: string }) => a.symbol === "USDT");
    expect(usdt).toMatchObject({ symbol: "USDT", displayName: "Tether", minAmount: 1, network: "TRC20" });
    expect(usdt.networks[0]).toMatchObject({ network: "TRC20", networkName: "Tron (TRC20)", isDefault: true, sell: true, buy: true });
  });

  it("gift card brands: variants with country, cardType, rateNgn, limits, denominations, isDefault", async () => {
    const res = await call(giftBrands.GET as unknown as Handler, null);
    const amazon = res.json.data.find((b: { brand: string }) => b.brand === "AMAZON");
    expect(amazon.displayName).toBe("Amazon");
    expect(amazon.variants[0]).toEqual({
      country: "US",
      cardType: "ECODE",
      rateNgn: 1200,
      minFaceValueUsd: 25,
      maxFaceValueUsd: 500,
      denominations: [],
      isDefault: true,
      updatedAt: expect.any(String),
    });
  });
});

describe("what the app sends", () => {
  it("sell crypto: quote, then order with quoteId and an idempotency key; a retried request makes one order", async () => {
    const user = await appUser();
    const quote = await call(quotes.POST as unknown as Handler, user.token, { kind: "CRYPTO", side: "SELL", symbol: "USDT", amount: 100 });
    expect(quote.status).toBe(201);
    expect(quote.json.data).toMatchObject({ amountNgn: 150_000, rateNgn: 1500, status: "OPEN", country: null, cardType: null });
    expect(typeof quote.json.data.expiresAt).toBe("string");

    const key = appKey();
    const body = { side: "SELL", quoteId: quote.json.data.id, network: "TRC20", payoutMethod: "WALLET" };
    const first = await call(cryptoOrders.POST as unknown as Handler, user.token, body, key);
    // The app's automatic retry after a lost answer: same key, same body.
    const retry = await call(cryptoOrders.POST as unknown as Handler, user.token, body, key);

    expect(first.status).toBe(201);
    expect(first.json.data.order).toMatchObject({ amountNgn: 150_000, network: "TRC20", depositAddress: "TDeskTronDepositAddress00000000001" });
    expect(retry.headers.get("idempotent-replay")).toBe("true");
    expect(retry.json).toEqual(first.json);
    expect(await prisma.cryptoOrder.count({ where: { userId: user.id } })).toBe(1);
    await settle();
  });

  it("buy crypto from the wallet: quote, then order with network, address and payFrom", async () => {
    const user = await appUser(200_000);
    const quote = await call(quotes.POST as unknown as Handler, user.token, { kind: "CRYPTO", side: "BUY", symbol: "USDT", amount: 50 });
    const order = await call(
      cryptoOrders.POST as unknown as Handler,
      user.token,
      { side: "BUY", quoteId: quote.json.data.id, network: "TRC20", userReceiveAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", payFrom: "WALLET" },
      appKey(),
    );
    expect(order.status).toBe(201);
    expect(order.json.data).toMatchObject({ order: { amountNgn: 76_000, network: "TRC20" }, checkout: null, checkoutError: null });
    expect(order.json.data.platformBank).toHaveProperty("accountNumber");
    expect(await balanceOf(user.id)).toBe(124_000);
    await settle();
  });

  it("buy crypto: the server's address check reaches the app as a readable message", async () => {
    const user = await appUser(200_000);
    const quote = await call(quotes.POST as unknown as Handler, user.token, { kind: "CRYPTO", side: "BUY", symbol: "USDT", amount: 50 });
    const order = await call(
      cryptoOrders.POST as unknown as Handler,
      user.token,
      { side: "BUY", quoteId: quote.json.data.id, network: "TRC20", userReceiveAddress: "0x52908400098527886E0F7030069857D2E4169EE7", payFrom: "WALLET" },
      appKey(),
    );
    expect(order.status).toBe(422);
    expect(order.json.error.message).toMatch(/TRC20/);
    expect(await balanceOf(user.id)).toBe(200_000);
  });

  it("sell gift card: quote with country and card type, then order with only quoteId, code and payout", async () => {
    const user = await appUser();
    const quote = await call(quotes.POST as unknown as Handler, user.token, {
      kind: "GIFTCARD",
      side: "SELL",
      symbol: "AMAZON",
      amount: 100,
      country: "GB",
      cardType: "PHYSICAL",
    });
    expect(quote.json.data).toMatchObject({ amountNgn: 100_000, country: "GB", cardType: "PHYSICAL" });

    const order = await call(
      giftOrders.POST as unknown as Handler,
      user.token,
      { quoteId: quote.json.data.id, cardCode: "ABCD-EFGH-IJKL-MNOP", payoutMethod: "WALLET" },
      appKey(),
    );
    expect(order.status).toBe(201);
    expect(order.json.data.order).toMatchObject({ amountNgn: 100_000, brand: "AMAZON" });
    expect(JSON.stringify(order.json)).not.toMatch(/ABCD-EFGH/);
    expect(await prisma.giftCardOrder.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ country: "GB", cardType: "PHYSICAL" });
    await settle();
  });

  it("an error always arrives as { error: { code, message } }, which lib/api.ts reads", async () => {
    const user = await appUser();
    const res = await call(cryptoOrders.POST as unknown as Handler, user.token, { side: "SELL", quoteId: "no-such-quote", payoutMethod: "WALLET" }, appKey());
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: { code: "not_found", message: "Quote not found." } });
  });
});
