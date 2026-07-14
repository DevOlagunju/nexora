import { NextResponse } from "next/server";
import { fetchLiveMarkets } from "@/lib/markets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const markets = await fetchLiveMarkets(30);
    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      count: markets.length,
      markets,
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load live market data right now." },
      { status: 502 },
    );
  }
}
