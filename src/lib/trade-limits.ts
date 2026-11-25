/**
 * Trade risk controls: daily NGN caps + suspicious gift-card heuristics.
 * Configure via env (see .env.example). Soft-blocks with clear errors.
 *
 * Pass a Prisma transaction client when creating orders so the check and
 * insert share one transaction (reduces limit bypass under concurrency).
 */

import { prisma } from "@/lib/db";
import { addNgn, sumNgn } from "@/lib/money";

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

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // WAT = UTC+1, no DST

/** Midnight in Lagos, so daily caps reset when Nigerian customers expect. */
export function startOfLagosDay(now = new Date()) {
  const d = new Date(now.getTime() + LAGOS_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - LAGOS_OFFSET_MS);
}

export async function assertDailyTradeAllowed(
  input: {
    userId: string;
    kind: TradeKind;
    amountNgn: number;
  },
  db: OrderDb = prisma,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const limits = tradeLimitsConfig();
  const since = startOfLagosDay();

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

  return evaluateDailyCaps({ cryptoToday, giftToday, kind: input.kind, amountNgn: input.amountNgn, limits });
}

/** Today's usage against each cap - same rules as enforcement, for dashboard meters. */
export async function getDailyUsage(userId: string, db: OrderDb = prisma) {
  const limits = tradeLimitsConfig();
  const since = startOfLagosDay();
  const where = { userId, createdAt: { gte: since }, status: { notIn: ["CANCELLED", "REJECTED"] as ("CANCELLED" | "REJECTED")[] } };
  const [cryptoToday, giftToday] = await Promise.all([
    db.cryptoOrder.findMany({ where, select: { amountNgn: true, side: true } }),
    db.giftCardOrder.findMany({ where, select: { amountNgn: true } }),
  ]);
  const sum = (rows: Array<{ amountNgn: number }>) => sumNgn(rows.map((o) => o.amountNgn));
  return {
    cryptoSell: { used: sum(cryptoToday.filter((o) => o.side === "SELL")), cap: limits.dailyCryptoSellNgn },
    cryptoBuy: { used: sum(cryptoToday.filter((o) => o.side === "BUY")), cap: limits.dailyCryptoBuyNgn },
    giftSell: { used: sum(giftToday), cap: limits.dailyGiftSellNgn },
    orders: { used: cryptoToday.length + giftToday.length, cap: limits.dailyOrderCount },
  };
}

type TradeKind = "crypto-sell" | "crypto-buy" | "gift-sell";

/** Pure cap check over today's non-failed orders (unit tested). */
export function evaluateDailyCaps(input: {
  cryptoToday: Array<{ amountNgn: number; side: "SELL" | "BUY" }>;
  giftToday: Array<{ amountNgn: number }>;
  kind: TradeKind;
  amountNgn: number;
  limits: ReturnType<typeof tradeLimitsConfig>;
}): { ok: true } | { ok: false; error: string } {
  const { cryptoToday, giftToday, limits } = input;
  const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

  if (cryptoToday.length + giftToday.length >= limits.dailyOrderCount) {
    return {
      ok: false,
      error: `Daily order limit reached (${limits.dailyOrderCount}). Contact support if you need a higher desk limit.`,
    };
  }

  const sum = (rows: Array<{ amountNgn: number }>) => sumNgn(rows.map((o) => o.amountNgn));
  const caps: Record<TradeKind, { used: number; cap: number; label: string }> = {
    "crypto-sell": {
      used: sum(cryptoToday.filter((o) => o.side === "SELL")),
      cap: limits.dailyCryptoSellNgn,
      label: "crypto sell",
    },
    "crypto-buy": {
      used: sum(cryptoToday.filter((o) => o.side === "BUY")),
      cap: limits.dailyCryptoBuyNgn,
      label: "crypto buy",
    },
    "gift-sell": { used: sum(giftToday), cap: limits.dailyGiftSellNgn, label: "gift card sell" },
  };
  const c = caps[input.kind];
  if (addNgn(c.used, input.amountNgn) > c.cap) {
    return {
      ok: false,
      error: `Daily ${c.label} cap is ${naira(c.cap)} (used ${naira(Math.round(c.used))} today). Reduce amount or try tomorrow.`,
    };
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
  const since = startOfLagosDay();
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
