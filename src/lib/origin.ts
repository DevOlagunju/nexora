/**
 * Public base URL for links we hand to payment providers (return page, test checkout).
 * Production should set NEXT_PUBLIC_APP_URL so a spoofed Host header can't change it.
 * In development we follow the request, so LAN phones and tunnels get a reachable URL.
 */
export function publicOrigin(h: Headers): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000").split(",")[0].trim();
  const local = host.startsWith("localhost") || host.startsWith("127.") || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(host);
  const proto = (h.get("x-forwarded-proto") ?? (local ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}
