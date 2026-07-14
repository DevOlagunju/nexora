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

/** Locale-stable clock — avoids SSR/client hydration mismatches from toLocaleTimeString() */
export function formatClockTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos",
  }).format(d);
}
