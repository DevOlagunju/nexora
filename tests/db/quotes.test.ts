import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { claimQuote, createQuote, getQuote, QuoteGoneError } from "@/lib/services/quotes";
import { createCryptoBuyOrder, createCryptoSellOrder, createGiftCardSellOrder } from "@/lib/services/trades";
import * as quotesRoute from "@/app/api/v1/quotes/route";
import { balanceOf, makeCustomer, settle } from "../helpers/fixtures";

const ctx = { ip: "127.0.0.1" };
const RECEIVE_ADDRESS = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";

const setRate = (symbol: string, sellRateNgn: number, buyRateNgn: number) =>
  prisma.rate.update({ where: { kind_symbol: { kind: "CRYPTO", symbol } }, data: { sellRateNgn, buyRateNgn } });

beforeAll(async () => {
  await prisma.rate.createMany({
    data: [
      { kind: "CRYPTO", symbol: "USDT", displayName: "Tether", sellRateNgn: 1344.25, buyRateNgn: 1364, minAmount: 10, maxAmount: 50_000 },
      { kind: "CRYPTO", symbol: "BTC", displayName: "Bitcoin", sellRateNgn: 150_000_000, buyRateNgn: 152_000_000, minAmount: 0.0001 },
      { kind: "GIFTCARD", symbol: "AMAZON", displayName: "Amazon", sellRateNgn: 1210.5, buyRateNgn: 0, minAmount: 25, maxAmount: 500 },
      // A crypto rate nobody has refreshed for two days.
      { kind: "CRYPTO", symbol: "ETH", displayName: "Ether", sellRateNgn: 4_000_000, buyRateNgn: 4_050_000, minAmount: 0.01, updatedAt: new Date(Date.now() - 2 * 24 * 3_600_000) },
    ],
  });
  await prisma.platformWallet.createMany({
    data: [
      { symbol: "USDT", network: "TRC20", address: "TPlatformDepositAddress000000000001" },
      { symbol: "BTC", network: "Bitcoin", address: "bc1qplatformdepositaddress0000000001" },
    ],
  });
});

describe("creating a quote", () => {
  it("prices the amount from the desk rate and promises it for a short time", async () => {
    const user = await makeCustomer();
    const res = await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "usdt", amount: 100 }, ctx);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({ symbol: "USDT", amount: 100, rateNgn: 1344.25, amountNgn: 134_425, feeNgn: 0, status: "OPEN", rateSource: "desk" });
    expect(res.data.secondsLeft).toBeGreaterThan(110);
    expect(res.data.secondsLeft).toBeLessThanOrEqual(120);
    expect(res.data.rateUpdatedAt).toBeInstanceOf(Date);
  });

  it("uses the buy rate for a purchase and rounds to the kobo", async () => {
    const user = await makeCustomer();
    const buy = await createQuote(user, { kind: "CRYPTO", side: "BUY", symbol: "BTC", amount: 0.00012345 }, ctx);
    expect(buy.ok && buy.data.rateNgn).toBe(152_000_000);
    expect(buy.ok && buy.data.amountNgn).toBe(18_764.4);
  });

  it("refuses amounts outside the limits, unknown assets and buying gift cards", async () => {
    const user = await makeCustomer();
    expect((await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "USDT", amount: 5 }, ctx)).ok).toBe(false);
    expect((await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "USDT", amount: 50_001 }, ctx)).ok).toBe(false);
    expect((await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "DOGE", amount: 100 }, ctx)).ok).toBe(false);
    expect((await createQuote(user, { kind: "GIFTCARD", side: "BUY", symbol: "AMAZON", amount: 100 }, ctx)).ok).toBe(false);
    expect((await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "USDT", amount: -100 }, ctx)).ok).toBe(false);
  });

  it("will not promise a price from a rate that has gone stale", async () => {
    const user = await makeCustomer();
    const res = await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "ETH", amount: 1 }, ctx);
    expect(res).toMatchObject({ ok: false, status: 503 });
    expect(await prisma.quote.count({ where: { userId: user.id } })).toBe(0);
  });

  it("is only visible to the customer it was made for", async () => {
    const owner = await makeCustomer();
    const stranger = await makeCustomer();
    const res = await createQuote(owner, { kind: "CRYPTO", side: "SELL", symbol: "USDT", amount: 100 }, ctx);
    if (!res.ok) throw new Error(res.error);

    expect((await getQuote(owner, res.data.id)).ok).toBe(true);
    expect(await getQuote(stranger, res.data.id)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("trading on a quote", () => {
  it("keeps the locked price even after the desk rate moves", async () => {
    const user = await makeCustomer();
    const quote = await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "USDT", amount: 100 }, ctx);
    if (!quote.ok) throw new Error(quote.error);

    await setRate("USDT", 1200, 1220); // the market drops after the quote was given
    try {
      const order = await createCryptoSellOrder(user, { quoteId: quote.data.id, payoutMethod: "WALLET" }, ctx);
      expect(order.ok).toBe(true);
      if (!order.ok) return;
      expect(order.data).toMatchObject({ symbol: "USDT", amountCrypto: 100, rateNgn: 1344.25, amountNgn: 134_425 });

      const used = await getQuote(user, quote.data.id);
      expect(used.ok && used.data).toMatchObject({ status: "ACCEPTED", orderReference: order.data.reference, secondsLeft: 0 });

      // Without a quote, the same order is priced at the rate of the moment.
      const unquoted = await createCryptoSellOrder(user, { symbol: "USDT", amountCrypto: 100, payoutMethod: "WALLET" }, ctx);
      expect(unquoted.ok && unquoted.data.rateNgn).toBe(1200);
    } finally {
      await setRate("USDT", 1344.25, 1364);
    }
    await settle();
  });

  it("takes the asset and amount from the quote, not from the request", async () => {
    const user = await makeCustomer();
    const quote = await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "USDT", amount: 100 }, ctx);
    if (!quote.ok) throw new Error(quote.error);

    // The request tries to trade ten times the quoted amount at the quoted total.
    const order = await createCryptoSellOrder(user, { quoteId: quote.data.id, symbol: "BTC", amountCrypto: 1_000, payoutMethod: "WALLET" }, ctx);
    expect(order.ok && order.data).toMatchObject({ symbol: "USDT", amountCrypto: 100, amountNgn: 134_425 });
    await settle();
  });

  it("can be used once", async () => {
    const user = await makeCustomer();
    const quote = await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "USDT", amount: 100 }, ctx);
    if (!quote.ok) throw new Error(quote.error);

    expect((await createCryptoSellOrder(user, { quoteId: quote.data.id, payoutMethod: "WALLET" }, ctx)).ok).toBe(true);
    expect(await createCryptoSellOrder(user, { quoteId: quote.data.id, payoutMethod: "WALLET" }, ctx)).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.cryptoOrder.count({ where: { userId: user.id } })).toBe(1);
    await settle();
  });

  it("creates exactly one order when accepted twice at the same instant", async () => {
    const user = await makeCustomer();
    const quote = await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "USDT", amount: 100 }, ctx);
    if (!quote.ok) throw new Error(quote.error);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => createCryptoSellOrder(user, { quoteId: quote.data.id, payoutMethod: "WALLET" }, ctx)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.cryptoOrder.count({ where: { userId: user.id } })).toBe(1);
    await settle();
  });

  it("cannot be used after it expires, and creates no order", async () => {
    const user = await makeCustomer();
    const expired = await prisma.quote.create({
      data: {
        reference: `NXQ-EXPIRED-${user.id.slice(-6)}`,
        userId: user.id,
        kind: "CRYPTO",
        side: "SELL",
        symbol: "USDT",
        amount: 100,
        rateNgn: 2_000, // a rate far better than today's: exactly what an expired quote must not deliver
        amountNgn: 200_000,
        rateUpdatedAt: new Date(Date.now() - 600_000),
        createdAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 480_000),
      },
    });

    expect(await createCryptoSellOrder(user, { quoteId: expired.id, payoutMethod: "WALLET" }, ctx)).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.cryptoOrder.count({ where: { userId: user.id } })).toBe(0);
    expect((await getQuote(user, expired.id)).ok && (await getQuote(user, expired.id))).toMatchObject({ data: { status: "EXPIRED", secondsLeft: 0 } });
  });

  it("is refused at the last moment if it expires between the check and the order", async () => {
    const user = await makeCustomer();
    const quote = await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "USDT", amount: 100 }, ctx);
    if (!quote.ok) throw new Error(quote.error);
    const justAfterExpiry = new Date(quote.data.expiresAt.getTime() + 1);

    await expect(prisma.$transaction((tx) => claimQuote(tx, quote.data.id, user.id, "NXC-LATE", justAfterExpiry))).rejects.toBeInstanceOf(QuoteGoneError);
    expect((await getQuote(user, quote.data.id)).ok && (await getQuote(user, quote.data.id))).toMatchObject({ data: { orderReference: null } });
  });

  it("cannot be used by another customer or for a different kind of trade", async () => {
    const owner = await makeCustomer({ balanceNgn: 500_000 });
    const stranger = await makeCustomer();
    const quote = await createQuote(owner, { kind: "CRYPTO", side: "SELL", symbol: "USDT", amount: 100 }, ctx);
    if (!quote.ok) throw new Error(quote.error);

    expect(await createCryptoSellOrder(stranger, { quoteId: quote.data.id, payoutMethod: "WALLET" }, ctx)).toMatchObject({ ok: false, status: 404 });
    // A sell quote cannot fund a purchase at the sell rate.
    expect(
      await createCryptoBuyOrder(owner, { quoteId: quote.data.id, userReceiveAddress: RECEIVE_ADDRESS, payFrom: "WALLET" }, ctx),
    ).toMatchObject({ ok: false, status: 422 });
    expect(await createGiftCardSellOrder(owner, { quoteId: quote.data.id, cardCode: "ABCD-EFGH-IJKL-MNOP", payoutMethod: "WALLET" }, ctx)).toMatchObject({
      ok: false,
      status: 422,
    });
    expect(await balanceOf(owner.id)).toBe(500_000);
    // The quote is still usable by its owner for what it was made for.
    expect((await getQuote(owner, quote.data.id)).ok && (await getQuote(owner, quote.data.id))).toMatchObject({ data: { status: "OPEN" } });
  });

  it("debits the wallet by the locked amount on a quoted purchase", async () => {
    const user = await makeCustomer({ balanceNgn: 500_000 });
    const quote = await createQuote(user, { kind: "CRYPTO", side: "BUY", symbol: "USDT", amount: 100 }, ctx);
    if (!quote.ok) throw new Error(quote.error);
    expect(quote.data.amountNgn).toBe(136_400);

    await setRate("USDT", 1344.25, 1500); // buying got dearer after the quote
    try {
      const order = await createCryptoBuyOrder(user, { quoteId: quote.data.id, userReceiveAddress: RECEIVE_ADDRESS, payFrom: "WALLET" }, ctx);
      expect(order.ok).toBe(true);
      expect(order.ok && order.data.order).toMatchObject({ rateNgn: 1364, amountNgn: 136_400 });
      expect(await balanceOf(user.id)).toBe(363_600);
    } finally {
      await setRate("USDT", 1344.25, 1364);
    }
    await settle();
  });

  it("releases nothing if the order fails after the quote was claimed", async () => {
    const user = await makeCustomer({ balanceNgn: 1_000 }); // not enough for the purchase
    const quote = await createQuote(user, { kind: "CRYPTO", side: "BUY", symbol: "USDT", amount: 100 }, ctx);
    if (!quote.ok) throw new Error(quote.error);

    const order = await createCryptoBuyOrder(user, { quoteId: quote.data.id, userReceiveAddress: RECEIVE_ADDRESS, payFrom: "WALLET" }, ctx);
    expect(order.ok).toBe(false);
    // The whole transaction rolled back, so the quote is still open and the balance untouched.
    expect((await getQuote(user, quote.data.id)).ok && (await getQuote(user, quote.data.id))).toMatchObject({ data: { status: "OPEN", orderReference: null } });
    expect(await balanceOf(user.id)).toBe(1_000);
  });
});

describe("POST /api/v1/quotes", () => {
  it("returns the quote in the v1 envelope", async () => {
    const user = await makeCustomer();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const token = await createSession({ id: row.id, email: row.email, fullName: row.fullName, phone: row.phone, role: row.role }, { setCookie: false });
    const res = await quotesRoute.POST(
      new Request("http://api.test/api/v1/quotes", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind: "GIFTCARD", side: "SELL", symbol: "AMAZON", amount: 100 }),
      }),
      { params: Promise.resolve({}) },
    );
    const json = (await res.json()) as { data: { amountNgn: number; rateNgn: number; status: string; expiresAt: string } };

    expect(res.status).toBe(201);
    expect(json.data).toMatchObject({ amountNgn: 121_050, rateNgn: 1210.5, status: "OPEN" });
    expect(new Date(json.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
