import { NextResponse } from "next/server";
import { fetchRateBenchmark, deskQuotesFromBenchmark } from "@/lib/rate-benchmark";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const benchmark = await fetchRateBenchmark();
    const desk = deskQuotesFromBenchmark(benchmark);

    await Promise.all(
      (["USDT", "BTC", "ETH"] as const).map((symbol) =>
        prisma.rate.updateMany({
          where: { kind: "CRYPTO", symbol },
          data: {
            sellRateNgn: desk[symbol].sell,
            buyRateNgn: desk[symbol].buy,
          },
        }),
      ),
    );

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
    return NextResponse.json({ error: "NGN market unavailable" }, { status: 502 });
  }
}
