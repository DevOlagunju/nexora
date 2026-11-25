import { describe, expect, it, vi } from "vitest";
import { formatNgnCompact } from "@/lib/format";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
const { buildActivity } = await import("@/lib/dashboard");

const at = (h: number) => new Date(Date.UTC(2026, 10, 16, h));

describe("buildActivity", () => {
  const crypto = [
    { id: "c1", reference: "NXC-1", side: "SELL" as const, symbol: "USDT", amountCrypto: 100, amountNgn: 137900, status: "COMPLETED" as const, createdAt: at(9), adminNote: null },
    { id: "c2", reference: "NXB-2", side: "BUY" as const, symbol: "BTC", amountCrypto: 0.01, amountNgn: 900000, status: "UNDER_REVIEW" as const, createdAt: at(12), adminNote: null },
  ];
  const gift = [
    { id: "g1", reference: "NXG-1", brand: "APPLE", country: "USA", faceValueUsd: 100, amountNgn: 121000, status: "APPROVED" as const, createdAt: at(11), adminNote: null },
  ];

  it("merges crypto and gift orders newest first", () => {
    expect(buildActivity(crypto, gift).map((i) => i.id)).toEqual(["c2", "g1", "c1"]);
  });

  it("labels each kind for the feed", () => {
    const [buy, card, sell] = buildActivity(crypto, gift);
    expect(buy).toMatchObject({ kind: "crypto-buy", title: "Buy 0.01 BTC" });
    expect(card).toMatchObject({ kind: "gift", title: "Apple gift card · $100" });
    expect(sell).toMatchObject({ kind: "crypto-sell", title: "Sell 100 USDT" });
  });

  it("respects the limit", () => {
    expect(buildActivity(crypto, gift, 2)).toHaveLength(2);
  });
});

describe("formatNgnCompact", () => {
  it("keeps small amounts exact and compacts large ones", () => {
    expect(formatNgnCompact(950)).toMatch(/950/);
    expect(formatNgnCompact(13_800)).toBe("₦13.8K");
    expect(formatNgnCompact(1_790_000)).toBe("₦1.79M");
    expect(formatNgnCompact(2_100_000_000)).toBe("₦2.1B");
    expect(formatNgnCompact(450_000)).toBe("₦450K");
  });
});
