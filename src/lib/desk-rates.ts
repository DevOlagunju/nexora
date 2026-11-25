import "server-only";
import { prisma } from "@/lib/db";
import { fetchRateBenchmark, marketMidsFromBenchmark } from "@/lib/rate-benchmark";

export type DeskLine = { mid: number; sell: number; buy: number };
export type DeskPayload = {
  market: { usdtNgn: number; btcNgn: number; ethNgn: number; fetchedAt: string };
  desk: { USDT: DeskLine; BTC: DeskLine; ETH: DeskLine };
};

/**
 * What public pages show: the live market mid next to Nexora's real desk rates (the ones an
 * order is priced at), never a rate made up from the market. Falls back to the last synced
 * market mid when the live feed is unavailable; null when there is nothing to show.
 */
export async function loadDeskPayload(): Promise<{ payload: DeskPayload; live: boolean } | null> {
  const stored = await prisma.rate.findMany({ where: { kind: "CRYPTO", symbol: { in: ["USDT", "BTC", "ETH"] } } });
  const bySymbol = new Map(stored.map((r) => [r.symbol, r]));

  let mids: { USDT: number; BTC: number; ETH: number } | null = null;
  let fetchedAt = new Date().toISOString();
  let live = false;
  try {
    const benchmark = await fetchRateBenchmark(bySymbol.get("USDT")?.marketRateNgn ?? undefined);
    mids = marketMidsFromBenchmark(benchmark);
    fetchedAt = benchmark.fetchedAt;
    live = true;
  } catch {
    /* use the stored market mids below */
  }

  const line = (symbol: "USDT" | "BTC" | "ETH"): DeskLine => {
    const r = bySymbol.get(symbol);
    const mid = mids?.[symbol] ?? r?.marketRateNgn ?? (r ? (r.sellRateNgn + r.buyRateNgn) / 2 : 0);
    return { mid, sell: r?.sellRateNgn ?? 0, buy: r?.buyRateNgn ?? 0 };
  };
  const desk = { USDT: line("USDT"), BTC: line("BTC"), ETH: line("ETH") };
  if (!desk.USDT.sell && !mids) return null;
  return {
    live,
    payload: { market: { usdtNgn: desk.USDT.mid, btcNgn: desk.BTC.mid, ethNgn: desk.ETH.mid, fetchedAt }, desk },
  };
}
