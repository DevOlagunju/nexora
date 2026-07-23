/**
 * Trade risk controls: daily NGN caps + suspicious gift-card heuristics.
 * Configure via env (see .env.example). Soft-blocks with clear errors.
 *
 * Pass a Prisma transaction client when creating orders so the check and
 * insert share one transaction (reduces limit bypass under concurrency).
 */

import { prisma } from "@/lib/db";

type OrderDb = Pick<typeof prisma, "cryptoOrder" | "giftCardOrder">;

function numEnv(key: string, fallback: number) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function tradeLimitsConfig() {
  return {
    dailyCryptoSellNgn: numEnv("DAILY_CRYPTO_SELL_LIMIT_NGN", 5_000_000),
    dailyCryptoBuyNgn: numEnv("DAILY_CRYPTO_BUY_LIMIT_NGN", 5_000_000),
    dailyGiftSellNgn: numEnv("DAILY_GIFT_SELL_LIMIT_NGN", 2_000_000),
    dailyOrderCount: numEnv("DAILY_ORDER_COUNT_LIMIT", 25),
    giftFraudFaceUsd: numEnv("GIFT_FRAUD_FACE_USD", 500),
  };
}

function startOfUtcDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function assertDailyTradeAllowed(
  input: {
    userId: string;
    kind: "crypto-sell" | "crypto-buy" | "gift-sell";
    amountNgn: number;
  },
  db: OrderDb = prisma,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const limits = tradeLimitsConfig();
  const since = startOfUtcDay();

  const [cryptoToday, giftToday] = await Promise.all([
    db.cryptoOrder.findMany({
      where: {
        userId: input.userId,
        createdAt: { gte: since },
        status: { notIn: ["CANCELLED", "REJECTED"] },
      },
      select: { amountNgn: true, side: true },
    }),
    db.giftCardOrder.findMany({
      where: {
        userId: input.userId,
        createdAt: { gte: since },
        status: { notIn: ["CANCELLED", "REJECTED"] },
      },
      select: { amountNgn: true },
    }),
  ]);

  const orderCount = cryptoToday.length + giftToday.length;
  if (orderCount >= limits.dailyOrderCount) {
    return {
      ok: false,
      error: `Daily order limit reached (${limits.dailyOrderCount}). Contact support if you need a higher desk limit.`,
    };
  }

  if (input.kind === "crypto-sell") {
    const used = cryptoToday.filter((o) => o.side === "SELL").reduce((s, o) => s + o.amountNgn, 0);
    if (used + input.amountNgn > limits.dailyCryptoSellNgn) {
      return {
        ok: false,
        error: `Daily crypto sell cap is ₦${limits.dailyCryptoSellNgn.toLocaleString("en-NG")}. Reduce amount or try tomorrow.`,
      };
    }
  }

  if (input.kind === "crypto-buy") {
    const used = cryptoToday.filter((o) => o.side === "BUY").reduce((s, o) => s + o.amountNgn, 0);
    if (used + input.amountNgn > limits.dailyCryptoBuyNgn) {
      return {
        ok: false,
        error: `Daily crypto buy cap is ₦${limits.dailyCryptoBuyNgn.toLocaleString("en-NG")}. Reduce amount or try tomorrow.`,
      };
    }
  }

  if (input.kind === "gift-sell") {
    const used = giftToday.reduce((s, o) => s + o.amountNgn, 0);
    if (used + input.amountNgn > limits.dailyGiftSellNgn) {
      return {
        ok: false,
        error: `Daily gift card sell cap is ₦${limits.dailyGiftSellNgn.toLocaleString("en-NG")}. Reduce amount or try tomorrow.`,
      };
    }
  }

  return { ok: true };
}

export type GiftRisk = {
  fraudFlag: boolean;
  fraudNote: string | null;
};

/** Heuristics for desk review - does not auto-reject. */
export async function assessGiftCardRisk(input: {
  userId: string;
  faceValueUsd: number;
  brand: string;
}): Promise<GiftRisk> {
  const limits = tradeLimitsConfig();
  const since = startOfUtcDay();
  const flags: string[] = [];

  if (input.faceValueUsd >= limits.giftFraudFaceUsd) {
    flags.push(`High face value (≥ $${limits.giftFraudFaceUsd})`);
  }

  const todaySameBrand = await prisma.giftCardOrder.count({
    where: {
      userId: input.userId,
      brand: input.brand,
      createdAt: { gte: since },
      status: { notIn: ["CANCELLED", "REJECTED"] },
    },
  });
  if (todaySameBrand >= 3) {
    flags.push(`Multiple ${input.brand} cards today (${todaySameBrand + 1})`);
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const burst = await prisma.giftCardOrder.count({
    where: {
      userId: input.userId,
      createdAt: { gte: hourAgo },
      status: { notIn: ["CANCELLED", "REJECTED"] },
    },
  });
  if (burst >= 5) {
    flags.push(`Burst volume (${burst + 1} gift orders in 1h)`);
  }

  if (flags.length === 0) {
    return { fraudFlag: false, fraudNote: null };
  }
  return { fraudFlag: true, fraudNote: flags.join("; ") };
}
