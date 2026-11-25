import { describe, expect, it } from "vitest";
import { deskRatesFromMid, marketMidsFromBenchmark } from "@/lib/rate-benchmark";

describe("deskRatesFromMid", () => {
  it("puts the margin in the rate: customers sell below the market and buy above it", () => {
    // The specification's illustration: ₦1,500,000 at market, ₦15,000 (1%) spread.
    expect(deskRatesFromMid(1_500_000, { sellSpreadPct: 1, buySpreadPct: 1 })).toEqual({ sell: 1_485_000, buy: 1_515_000 });
  });

  it("can use different spreads each way", () => {
    expect(deskRatesFromMid(1_500, { sellSpreadPct: 0.5, buySpreadPct: 1.5 })).toEqual({ sell: 1_492.5, buy: 1_522.5 });
  });

  it("with no spread the rate is the market", () => {
    expect(deskRatesFromMid(1_500, { sellSpreadPct: 0, buySpreadPct: 0 })).toEqual({ sell: 1_500, buy: 1_500 });
  });

  it("rounds to the kobo", () => {
    expect(deskRatesFromMid(1_499.99, { sellSpreadPct: 1.333, buySpreadPct: 1.333 })).toEqual({ sell: 1_480, buy: 1_519.98 });
  });

  it("never lets a bad spread produce a nonsense rate", () => {
    expect(deskRatesFromMid(1_000, { sellSpreadPct: -5, buySpreadPct: Number.NaN })).toEqual({ sell: 1_000, buy: 1_000 });
    expect(deskRatesFromMid(1_000, { sellSpreadPct: 500, buySpreadPct: 500 })).toEqual({ sell: 500, buy: 1_500 });
  });
});

describe("marketMidsFromBenchmark", () => {
  it("prices BTC and ETH in Naira through the USDT/NGN mid", () => {
    const mids = marketMidsFromBenchmark({ referenceMid: 1_500, btcUsd: 100_000, ethUsd: 3_000.5, fetchedAt: "", source: "test" });
    expect(mids).toEqual({ USDT: 1_500, BTC: 150_000_000, ETH: 4_500_750 });
  });
});
