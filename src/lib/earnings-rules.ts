import { mulNgn, subNgn, sumNgn } from "@/lib/money";

/**
 * What trades earned. Pure, unit tested (tests/earnings-rules.test.ts).
 *
 * Crypto earns the spread: on a sell Nexora paid the customer below the market price, on a buy
 * it charged above it. Gift cards earn the gap between what the desk got for the card and what it
 * paid the customer. These are expected earnings at the market price of the moment; what the desk
 * actually realises depends on when and where it trades the asset on.
 */

export type CryptoTrade = {
  symbol: string;
  side: "SELL" | "BUY";
  amountCrypto: number;
  rateNgn: number;
  amountNgn: number;
  marketRateNgn: number | null;
};

/** The spread a crypto trade earned, or null when the market price at the time is unknown. */
export function cryptoEarning(t: CryptoTrade): number | null {
  if (t.marketRateNgn === null || !(t.marketRateNgn > 0)) return null;
  const perUnit = t.side === "SELL" ? subNgn(t.marketRateNgn, t.rateNgn) : subNgn(t.rateNgn, t.marketRateNgn);
  return mulNgn(perUnit, t.amountCrypto);
}

export type GiftTrade = { brand: string; amountNgn: number; redeemedNgn: number | null };

/** What a gift card earned, or null until the desk records what it got for the card. */
export function giftEarning(t: GiftTrade): number | null {
  return t.redeemedNgn === null ? null : subNgn(t.redeemedNgn, t.amountNgn);
}

export type Line = { key: string; trades: number; volumeNgn: number; earnedNgn: number; unpriced: number };

/** Totals per key (asset or brand). Trades with no earning yet are counted, not guessed. */
export function summarise<T>(items: T[], key: (t: T) => string, volume: (t: T) => number, earning: (t: T) => number | null): Line[] {
  const groups = new Map<string, T[]>();
  for (const t of items) groups.set(key(t), [...(groups.get(key(t)) ?? []), t]);
  return [...groups.entries()]
    .map(([k, ts]) => {
      const earned = ts.map(earning);
      return {
        key: k,
        trades: ts.length,
        volumeNgn: sumNgn(ts.map(volume)),
        earnedNgn: sumNgn(earned.filter((e): e is number => e !== null)),
        unpriced: earned.filter((e) => e === null).length,
      };
    })
    .sort((a, b) => b.volumeNgn - a.volumeNgn);
}
