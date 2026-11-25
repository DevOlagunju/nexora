/**
 * Pure rules for quotes. No I/O, unit tested (tests/quote-rules.test.ts).
 *
 * A quote locks a rate for a short time. It is only as good as the rate behind it, so a
 * quote is refused when that rate has not been refreshed recently enough.
 */

export type QuoteConfig = {
  /** How long a quote stays valid. */
  ttlSeconds: number;
  /** A crypto rate older than this is too stale to quote from. */
  maxCryptoRateAgeMinutes: number;
  /** Gift card rates are set by hand and move slowly, so they are allowed to be older. */
  maxGiftRateAgeMinutes: number;
};

function num(raw: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export function quoteConfig(env: Record<string, string | undefined> = process.env): QuoteConfig {
  return {
    ttlSeconds: num(env.QUOTE_TTL_SECONDS, 120, 15, 900),
    maxCryptoRateAgeMinutes: num(env.QUOTE_MAX_CRYPTO_RATE_AGE_MINUTES, 360, 1, 7 * 24 * 60),
    maxGiftRateAgeMinutes: num(env.QUOTE_MAX_GIFT_RATE_AGE_MINUTES, 7 * 24 * 60, 1, 90 * 24 * 60),
  };
}

/** True when the rate was last set too long ago to promise a price from it. */
export function rateIsStale(kind: "CRYPTO" | "GIFTCARD", rateUpdatedAt: Date, cfg: QuoteConfig, now = new Date()): boolean {
  const maxMinutes = kind === "CRYPTO" ? cfg.maxCryptoRateAgeMinutes : cfg.maxGiftRateAgeMinutes;
  return now.getTime() - rateUpdatedAt.getTime() > maxMinutes * 60_000;
}

export function quoteExpiry(cfg: QuoteConfig, now = new Date()): Date {
  return new Date(now.getTime() + cfg.ttlSeconds * 1000);
}

export type QuoteStatus = "OPEN" | "ACCEPTED" | "EXPIRED";

export function quoteStatus(quote: { expiresAt: Date; acceptedAt: Date | null }, now = new Date()): QuoteStatus {
  if (quote.acceptedAt) return "ACCEPTED";
  return quote.expiresAt.getTime() > now.getTime() ? "OPEN" : "EXPIRED";
}

/** Whole seconds left on a quote, never negative. */
export function secondsLeft(quote: { expiresAt: Date }, now = new Date()): number {
  return Math.max(0, Math.floor((quote.expiresAt.getTime() - now.getTime()) / 1000));
}
