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

type CoinGeckoMarket = {
  id: string;
  name: string;
  symbol: string;
  image: string;
  market_cap: number | null;
  fully_diluted_valuation: number | null;
  current_price: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  total_volume: number | null;
  price_change_percentage_24h: number | null;
};

export function formatCompactUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)} T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)} B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)} M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)} K`;
  return `${sign}${abs.toFixed(2)}`;
}

export function formatPriceUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
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
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(abs / 1e12).toFixed(2)} T`;
  if (abs >= 1e9) return `${(abs / 1e9).toFixed(2)} B`;
  if (abs >= 1e6) return `${(abs / 1e6).toFixed(2)} M`;
  if (abs >= 1e3) return `${(abs / 1e3).toFixed(2)} K`;
  return abs.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export async function fetchLiveMarkets(limit = 25): Promise<MarketRow[]> {
  const url = new URL("https://api.coingecko.com/api/v3/coins/markets");
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("order", "market_cap_desc");
  url.searchParams.set("per_page", String(limit));
  url.searchParams.set("page", "1");
  url.searchParams.set("sparkline", "false");
  url.searchParams.set("price_change_percentage", "24h");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: 30 },
  });

  if (!res.ok) {
    throw new Error(`Market feed unavailable (${res.status})`);
  }

  const data = (await res.json()) as CoinGeckoMarket[];
  return data.map((coin) => ({
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol.toUpperCase(),
    image: coin.image,
    marketCap: coin.market_cap,
    fdv: coin.fully_diluted_valuation,
    price: coin.current_price,
    circulating: coin.circulating_supply,
    totalSupply: coin.total_supply,
    volume: coin.total_volume,
    change24h: coin.price_change_percentage_24h,
  }));
}
