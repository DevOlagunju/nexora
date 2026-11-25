import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Next 16 Proxy (formerly middleware): CORS for the JSON API.
 * Native mobile apps send no Origin and are unaffected; this matters for Expo web
 * and any browser client. Allowed origins come from CORS_ALLOWED_ORIGINS (comma list).
 * Private LAN / localhost origins are accepted only outside production.
 */

const DEV_ORIGINS = ["http://localhost:8081", "http://127.0.0.1:8081", "http://localhost:19006"];

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const configured = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (configured.includes(origin)) return origin;

  if (process.env.NODE_ENV !== "production") {
    if (DEV_ORIGINS.includes(origin)) return origin;
    if (/^http:\/\/(192\.168|10)\.\d{1,3}\.\d{1,3}(\.\d{1,3})?(:\d+)?$/.test(origin)) return origin;
  }
  return null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = allowedOrigin(origin);
  if (!allow) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  // Webhooks are server-to-server and must not be touched.
  matcher: ["/api/((?!webhooks/|v1/webhooks/).*)"],
};
