import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const { evaluateDailyCaps, startOfLagosDay } = await import("@/lib/trade-limits");

const limits = {
  dailyCryptoSellNgn: 1_000_000,
  dailyCryptoBuyNgn: 500_000,
  dailyGiftSellNgn: 200_000,
  dailyOrderCount: 3,
  giftFraudFaceUsd: 500,
};

describe("evaluateDailyCaps", () => {
  it("allows an order inside the cap", () => {
    const r = evaluateDailyCaps({ cryptoToday: [], giftToday: [], kind: "crypto-sell", amountNgn: 999_999, limits });
    expect(r.ok).toBe(true);
  });

  it("counts only the matching side toward crypto caps", () => {
    const cryptoToday = [{ amountNgn: 400_000, side: "BUY" as const }];
    expect(
      evaluateDailyCaps({ cryptoToday, giftToday: [], kind: "crypto-sell", amountNgn: 900_000, limits }).ok,
    ).toBe(true);
    expect(
      evaluateDailyCaps({ cryptoToday, giftToday: [], kind: "crypto-buy", amountNgn: 200_000, limits }).ok,
    ).toBe(false);
  });

  it("blocks once the order count limit is reached", () => {
    const r = evaluateDailyCaps({
      cryptoToday: [
        { amountNgn: 1, side: "SELL" },
        { amountNgn: 1, side: "BUY" },
      ],
      giftToday: [{ amountNgn: 1 }],
      kind: "gift-sell",
      amountNgn: 1,
      limits,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/order limit/);
  });

  it("enforces the gift cap", () => {
    const r = evaluateDailyCaps({
      cryptoToday: [],
      giftToday: [{ amountNgn: 150_000 }],
      kind: "gift-sell",
      amountNgn: 60_000,
      limits,
    });
    expect(r.ok).toBe(false);
  });
});

describe("startOfLagosDay", () => {
  it("returns 23:00 UTC of the previous UTC day (midnight WAT)", () => {
    expect(startOfLagosDay(new Date("2026-03-10T12:00:00Z")).toISOString()).toBe("2026-03-09T23:00:00.000Z");
  });

  it("rolls over at 23:00 UTC", () => {
    expect(startOfLagosDay(new Date("2026-03-10T23:30:00Z")).toISOString()).toBe("2026-03-10T23:00:00.000Z");
  });
});
