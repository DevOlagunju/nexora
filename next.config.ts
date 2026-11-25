import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Baseline security headers. The CSP sticks to directives that cannot break
 * rendering (no script-src lockdown yet); tighten with nonces once stable.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  // Docker image sets NEXT_OUTPUT=standalone; `next start` keeps working locally.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  // Dev only: let testers open the dev server through a Cloudflare quick tunnel or the LAN IP.
  allowedDevOrigins: ["*.trycloudflare.com", "192.168.*.*"],
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3", "pg", "@prisma/adapter-pg"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
