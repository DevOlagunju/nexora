import { describe, expect, it } from "vitest";
import { cryptoEarning, giftEarning, summarise } from "@/lib/earnings-rules";

const trade = (over: Partial<Parameters<typeof cryptoEarning>[0]> = {}) => ({
  symbol: "USDT",
  side: "SELL" as const,
  amountCrypto: 1_000,
  rateNgn: 1_485,
  amountNgn: 1_485_000,
  marketRateNgn: 1_500,
  ...over,
});

describe("cryptoEarning", () => {
  it("a customer selling below the market earns the gap", () => {
    expect(cryptoEarning(trade())).toBe(15_000);
  });

  it("a customer buying above the market earns the gap", () => {
    expect(cryptoEarning(trade({ side: "BUY", rateNgn: 1_515, amountNgn: 1_515_000 }))).toBe(15_000);
  });

  it("shows a loss when the desk rate was on the wrong side of the market", () => {
    expect(cryptoEarning(trade({ rateNgn: 1_510 }))).toBe(-10_000);
  });

  it("works to the kobo on small crypto amounts", () => {
    expect(cryptoEarning(trade({ symbol: "BTC", amountCrypto: 0.00012345, rateNgn: 148_500_000, marketRateNgn: 150_000_000 }))).toBe(185.18);
  });

  it("is unknown, not zero, without a market price", () => {
    expect(cryptoEarning(trade({ marketRateNgn: null }))).toBeNull();
  });
});

describe("giftEarning", () => {
  it("is what the card was redeemed for minus what the customer was paid", () => {
    expect(giftEarning({ brand: "AMAZON", amountNgn: 120_000, redeemedNgn: 135_000 })).toBe(15_000);
    expect(giftEarning({ brand: "AMAZON", amountNgn: 120_000, redeemedNgn: 0 })).toBe(-120_000);
  });

  it("is unknown until the desk records the redemption", () => {
    expect(giftEarning({ brand: "AMAZON", amountNgn: 120_000, redeemedNgn: null })).toBeNull();
  });
});

describe("summarise", () => {
  it("totals per key, counts unknown earnings rather than guessing, biggest volume first", () => {
    const lines = summarise(
      [trade(), trade({ marketRateNgn: null }), trade({ symbol: "BTC", amountNgn: 5_000_000, amountCrypto: 0.05, rateNgn: 99_000_000, marketRateNgn: 100_000_000 })],
      (t) => t.symbol,
      (t) => t.amountNgn,
      cryptoEarning,
    );
    expect(lines).toEqual([
      { key: "BTC", trades: 1, volumeNgn: 5_000_000, earnedNgn: 50_000, unpriced: 0 },
      { key: "USDT", trades: 2, volumeNgn: 2_970_000, earnedNgn: 15_000, unpriced: 1 },
    ]);
  });
});
