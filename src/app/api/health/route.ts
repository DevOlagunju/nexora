import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for load balancers, Docker and uptime monitors.
 * 200 when the app can reach the database, 503 otherwise. No secrets in the body.
 */
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return NextResponse.json(
      {
        status: "ok",
        db: "ok",
        latencyMs: Date.now() - started,
        version: process.env.APP_VERSION ?? process.env.npm_package_version ?? "dev",
        at: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", db: "unreachable", at: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
