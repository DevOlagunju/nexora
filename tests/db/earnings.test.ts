import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createCryptoSellOrder } from "@/lib/services/trades";
import { createQuote } from "@/lib/services/quotes";
import { processWithdrawal, requestWithdrawal } from "@/lib/services/wallet";
import { earningsReport, recordGiftRedemption } from "@/lib/services/reports";
import { makeAdmin, makeCustomer, settle, TEST_PIN } from "../helpers/fixtures";

const ctx = { ip: "127.0.0.1" };
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
let seq = 0;

/** A completed crypto order, as the desk would leave it. */
function completedCrypto(userId: string, o: { side: "SELL" | "BUY"; rateNgn: number; marketRateNgn: number | null; amountCrypto: number; at?: Date }) {
  return prisma.cryptoOrder.create({
    data: {
      reference: `NXC-EARN-${Date.now().toString(36)}-${seq++}`,
      userId,
      symbol: "USDT",
      network: "TRC20",
      side: o.side,
      amountCrypto: o.amountCrypto,
      rateNgn: o.rateNgn,
      marketRateNgn: o.marketRateNgn,
      amountNgn: o.amountCrypto * o.rateNgn,
      status: "COMPLETED",
      completedAt: o.at ?? minutesAgo(5),
    },
  });
}

beforeAll(async () => {
  await prisma.rate.create({
    data: { kind: "CRYPTO", symbol: "USDT", displayName: "Tether", sellRateNgn: 1_485, buyRateNgn: 1_515, minAmount: 1, marketRateNgn: 1_500, marketRateAt: new Date() },
  });
  const tron = await prisma.blockchainNetwork.findUniqueOrThrow({ where: { code: "TRC20" } });
  await prisma.assetNetwork.create({ data: { symbol: "USDT", networkId: tron.id, depositAddress: "TDeskTronDepositAddress00000000001", confirmations: 20, isDefault: true } });
});

describe("orders remember the market price", () => {
  it("from the quote when there is one, else from the last sync", async () => {
    const user = await makeCustomer();
    const quote = await createQuote(user, { kind: "CRYPTO", side: "SELL", symbol: "USDT", amount: 100 }, ctx);
    if (!quote.ok) throw new Error(quote.error);
    // The market moves after the quote; the order keeps the quote's market price.
    await prisma.rate.update({ where: { kind_symbol: { kind: "CRYPTO", symbol: "USDT" } }, data: { marketRateNgn: 1_600 } });
    try {
      const quoted = await createCryptoSellOrder(user, { quoteId: quote.data.id, payoutMethod: "WALLET" }, ctx);
      expect(quoted.ok && quoted.data.marketRateNgn).toBe(1_500);
      const plain = await createCryptoSellOrder(user, { symbol: "USDT", amountCrypto: 10, payoutMethod: "WALLET" }, ctx);
      expect(plain.ok && plain.data.marketRateNgn).toBe(1_600);
    } finally {
      await prisma.rate.update({ where: { kind_symbol: { kind: "CRYPTO", symbol: "USDT" } }, data: { marketRateNgn: 1_500 } });
    }
    await settle();
  });
});

describe("earnings report", () => {
  it("adds up spread, gift card margin and fees for completed trades in the period only", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer({ balanceNgn: 20_000 });
    const from = minutesAgo(60);

    await completedCrypto(user.id, { side: "SELL", rateNgn: 1_485, marketRateNgn: 1_500, amountCrypto: 1_000 }); // +15,000
    await completedCrypto(user.id, { side: "BUY", rateNgn: 1_515, marketRateNgn: 1_500, amountCrypto: 200 }); // +3,000
    await completedCrypto(user.id, { side: "SELL", rateNgn: 1_485, marketRateNgn: null, amountCrypto: 10 }); // unpriced
    await completedCrypto(user.id, { side: "SELL", rateNgn: 1_400, marketRateNgn: 1_500, amountCrypto: 1_000, at: minutesAgo(120) }); // outside period

    const gift = await prisma.giftCardOrder.create({
      data: {
        reference: `NXG-EARN-${seq++}`,
        userId: user.id,
        brand: "AMAZON",
        faceValueUsd: 100,
        rateNgn: 1_200,
        amountNgn: 120_000,
        cardCodeEncrypted: "x",
        cardCodeIv: "y",
        status: "COMPLETED",
        completedAt: minutesAgo(10),
      },
    });
    expect((await recordGiftRedemption(admin, { id: gift.id, redeemedNgn: "132500" })).ok).toBe(true); // +12,500

    // A ₦50 withdrawal fee becomes revenue when the withdrawal is paid.
    expect((await requestWithdrawal(user, { amountNgn: 5_000, pin: TEST_PIN }, ctx)).ok).toBe(true);
    const w = await prisma.withdrawal.findFirstOrThrow({ where: { userId: user.id } });
    expect((await processWithdrawal(admin, { id: w.id, action: "mark-paid", payoutRef: "GTB-1" })).ok).toBe(true);

    const r = await earningsReport(from, new Date());
    const crypto = Object.fromEntries(r.crypto.map((l) => [l.key, l]));
    expect(crypto["USDT bought from customers"]).toMatchObject({ trades: 2, earnedNgn: 15_000, unpriced: 1 });
    expect(crypto["USDT sold to customers"]).toMatchObject({ trades: 1, earnedNgn: 3_000 });
    expect(r.gift).toEqual([{ key: "AMAZON", trades: 1, volumeNgn: 120_000, earnedNgn: 12_500, unpriced: 0 }]);
    expect(r.feesNgn).toBe(50);
    expect(r.totalNgn).toBe(30_550);
    expect(r.unpriced).toBe(1);
    await settle();
  });

  it("an empty period is zero, not an error", async () => {
    const r = await earningsReport(new Date(Date.now() + 3_600_000), new Date(Date.now() + 7_200_000));
    expect(r).toMatchObject({ crypto: [], gift: [], feesNgn: 0, totalNgn: 0, unpriced: 0 });
  });
});

describe("recording a gift card redemption", () => {
  it("is refused for a card that was rejected, and audited when changed", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const base = { userId: user.id, brand: "STEAM", faceValueUsd: 50, rateNgn: 900, amountNgn: 45_000, cardCodeEncrypted: "x", cardCodeIv: "y" };
    const rejected = await prisma.giftCardOrder.create({ data: { ...base, reference: `NXG-R-${seq++}`, status: "REJECTED" } });
    expect(await recordGiftRedemption(admin, { id: rejected.id, redeemedNgn: "50000" })).toMatchObject({ ok: false, status: 409 });

    const ok = await prisma.giftCardOrder.create({ data: { ...base, reference: `NXG-A-${seq++}`, status: "APPROVED" } });
    await recordGiftRedemption(admin, { id: ok.id, redeemedNgn: "50000" });
    await recordGiftRedemption(admin, { id: ok.id, redeemedNgn: "49000" });
    const audits = await prisma.auditLog.findMany({ where: { userId: admin.id, action: "admin.gift_redemption" }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => JSON.parse(a.meta ?? "{}").to)).toEqual([50_000, 49_000]);
    expect(await recordGiftRedemption(admin, { id: ok.id, redeemedNgn: "-5" })).toMatchObject({ ok: false });
  });
});
