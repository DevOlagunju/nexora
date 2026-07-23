import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchReliableDeskBenchmark, deskQuotesFromBenchmark } from "@/lib/rate-benchmark";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/sync-rates
 * Header: Authorization: Bearer <CRON_SECRET>
 * Schedule hourly via Vercel Cron / GitHub Action / system cron.
 * Avoids CoinGecko 429 by preferring Binance/Coinbase (see rate-benchmark).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const usdt = await prisma.rate.findFirst({ where: { kind: "CRYPTO", symbol: "USDT" } });
    const btc = await prisma.rate.findFirst({ where: { kind: "CRYPTO", symbol: "BTC" } });
    const eth = await prisma.rate.findFirst({ where: { kind: "CRYPTO", symbol: "ETH" } });
    const mid = usdt?.sellRateNgn ?? 1380;

    const benchmark = await fetchReliableDeskBenchmark({
      ngnMidHint: mid,
      btcUsdHint: btc && mid > 0 ? btc.sellRateNgn / mid : undefined,
      ethUsdHint: eth && mid > 0 ? eth.sellRateNgn / mid : undefined,
    });
    const desk = deskQuotesFromBenchmark(benchmark);

    await Promise.all(
      (["USDT", "BTC", "ETH"] as const).map((symbol) =>
        prisma.rate.updateMany({
          where: { kind: "CRYPTO", symbol },
          data: {
            sellRateNgn: desk[symbol].sell,
            buyRateNgn: desk[symbol].buy,
            isActive: true,
          },
        }),
      ),
    );

    return NextResponse.json({
      ok: true,
      source: benchmark.source,
      usdt: desk.USDT,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 502 },
    );
  }
}
