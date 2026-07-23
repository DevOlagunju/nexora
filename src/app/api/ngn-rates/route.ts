import { NextResponse } from "next/server";
import { fetchRateBenchmark, deskQuotesFromBenchmark } from "@/lib/rate-benchmark";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const benchmark = await fetchRateBenchmark();
    const desk = deskQuotesFromBenchmark(benchmark);

    // Live market is for the live card only - admin desk rates stay in DB
    return NextResponse.json({
      market: {
        usdtNgn: benchmark.referenceMid,
        btcNgn: desk.BTC.mid,
        ethNgn: desk.ETH.mid,
        fetchedAt: benchmark.fetchedAt,
      },
      desk: {
        USDT: desk.USDT,
        BTC: desk.BTC,
        ETH: desk.ETH,
      },
    });
  } catch {
    const stored = await prisma.rate.findMany({
      where: { kind: "CRYPTO", symbol: { in: ["USDT", "BTC", "ETH"] }, isActive: true },
    });
    if (stored.length === 0) {
      return NextResponse.json({ error: "NGN market unavailable" }, { status: 502 });
    }
    const bySymbol = Object.fromEntries(stored.map((r) => [r.symbol, r]));
    const mid = (s: string) => {
      const r = bySymbol[s];
      return r ? (r.sellRateNgn + r.buyRateNgn) / 2 : 0;
    };
    return NextResponse.json({
      market: {
        usdtNgn: mid("USDT"),
        btcNgn: mid("BTC"),
        ethNgn: mid("ETH"),
        fetchedAt: new Date().toISOString(),
      },
      desk: {
        USDT: {
          mid: mid("USDT"),
          sell: bySymbol.USDT?.sellRateNgn ?? 0,
          buy: bySymbol.USDT?.buyRateNgn ?? 0,
        },
        BTC: {
          mid: mid("BTC"),
          sell: bySymbol.BTC?.sellRateNgn ?? 0,
          buy: bySymbol.BTC?.buyRateNgn ?? 0,
        },
        ETH: {
          mid: mid("ETH"),
          sell: bySymbol.ETH?.sellRateNgn ?? 0,
          buy: bySymbol.ETH?.buyRateNgn ?? 0,
        },
      },
    });
  }
}
