import { NextResponse } from "next/server";
import { loadDeskPayload } from "@/lib/desk-rates";

export const dynamic = "force-dynamic";

/**
 * Live card data: the market mid next to Nexora's real desk rates. The shape is unchanged:
 * { market: { usdtNgn, btcNgn, ethNgn, fetchedAt }, desk: { USDT|BTC|ETH: { mid, sell, buy } } }.
 */
export async function GET() {
  const result = await loadDeskPayload();
  if (!result) return NextResponse.json({ error: "NGN market unavailable" }, { status: 502 });
  return NextResponse.json(result.payload);
}
