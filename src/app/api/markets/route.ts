import { NextResponse } from "next/server";
import { fetchLiveMarkets, marketsCacheAgeMs } from "@/lib/markets-live";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const markets = await fetchLiveMarkets(30);
    const age = marketsCacheAgeMs();
    return NextResponse.json({
      updatedAt: new Date(Date.now() - (age ?? 0)).toISOString(),
      count: markets.length,
      markets,
      cached: age != null && age > 0,
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load live market data right now." },
      { status: 502 },
    );
  }
}
