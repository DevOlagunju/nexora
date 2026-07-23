export type MarketRow = {
  id: string;
  name: string;
  symbol: string;
  image: string;
  marketCap: number | null;
  fdv: number | null;
  price: number | null;
  circulating: number | null;
  totalSupply: number | null;
  volume: number | null;
  change24h: number | null;
};

export function formatCompactUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)} T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)} B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)} M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)} K`;
  return `${sign}${abs.toFixed(2)}`;
}

export function formatPriceUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  if (value >= 1000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (value >= 1) {
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (value >= 0.01) {
    return value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 5 });
  }
  return value.toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 8 });
}

/** Compact coin supply with T/B/M/K */
export function formatSupply(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "N/A";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(abs / 1e12).toFixed(2)} T`;
  if (abs >= 1e9) return `${(abs / 1e9).toFixed(2)} B`;
  if (abs >= 1e6) return `${(abs / 1e6).toFixed(2)} M`;
  if (abs >= 1e3) return `${(abs / 1e3).toFixed(2)} K`;
  return abs.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
