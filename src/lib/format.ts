export function formatNgn(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCrypto(amount: number, symbol: string): string {
  const digits = symbol === "BTC" ? 6 : symbol === "ETH" ? 4 : 2;
  return `${amount.toFixed(digits)} ${symbol}`;
}

/** Locale-stable clock  -  avoids SSR/client hydration mismatches from toLocaleTimeString() */
export function formatClockTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "N/A";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos",
  }).format(d);
}

/** Compact NGN for KPI tiles: ₦950, ₦13.8K, ₦1.38M, ₦2.1B. */
export function formatNgnCompact(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  const fmt = (n: number, unit: string) => `${sign}₦${n >= 100 ? Math.round(n) : Number(n.toFixed(n >= 10 ? 1 : 2))}${unit}`;
  if (abs >= 1e9) return fmt(abs / 1e9, "B");
  if (abs >= 1e6) return fmt(abs / 1e6, "M");
  if (abs >= 1e4) return fmt(abs / 1e3, "K");
  return formatNgn(amount);
}
