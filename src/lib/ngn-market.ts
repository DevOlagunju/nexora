import { deskQuotesFromBenchmark, fetchRateBenchmark } from "@/lib/rate-benchmark";

export type NgnMarketQuote = {
  usdtNgn: number;
  btcUsd: number;
  ethUsd: number;
  btcNgn: number;
  ethNgn: number;
  fetchedAt: string;
  nexoraSell: number;
  nexoraBuy: number;
};

/** Live NGN desk pricing — CoinGecko + Jeroid only */
export async function fetchNgnMarket(): Promise<NgnMarketQuote> {
  const b = await fetchRateBenchmark();
  return {
    usdtNgn: b.referenceMid,
    btcUsd: b.btcUsd,
    ethUsd: b.ethUsd,
    btcNgn: b.btcUsd * b.referenceMid,
    ethNgn: b.ethUsd * b.referenceMid,
    fetchedAt: b.fetchedAt,
    nexoraSell: b.nexoraSell,
    nexoraBuy: b.nexoraBuy,
  };
}

export function deskQuotesFromMarket(market: NgnMarketQuote) {
  return deskQuotesFromBenchmark({
    referenceMid: market.usdtNgn,
    nexoraSell: market.nexoraSell,
    nexoraBuy: market.nexoraBuy,
    btcUsd: market.btcUsd,
    ethUsd: market.ethUsd,
    btcNgnSell: Math.round(market.btcUsd * market.nexoraSell),
    ethNgnSell: Math.round(market.ethUsd * market.nexoraSell),
    fetchedAt: market.fetchedAt,
  });
}
