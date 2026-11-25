import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { syncDeskRatesFromMarket } from "@/lib/services/desk";
import { writeAudit } from "@/lib/security";
import { log } from "@/lib/log";

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
  if (!safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncDeskRatesFromMarket();
  if (!result.ok) {
    log.warn("cron: rate sync failed", { error: result.error });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  await writeAudit("cron.rates_sync", { meta: { source: result.data.source } });
  return NextResponse.json({
    ok: true,
    source: result.data.source,
    usdt: result.data.desk.USDT,
    at: new Date().toISOString(),
  });
}
