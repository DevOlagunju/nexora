import "server-only";
import dns from "node:dns";
import type { MarketRow } from "@/lib/markets";

dns.setDefaultResultOrder("ipv4first");

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

type BinanceTicker = {
  symbol: string;
  lastPrice: string;
  quoteVolume: string;
  priceChangePercent: string;
};

const CACHE_TTL_MS = 25_000;
const UPSTREAM_TIMEOUT_MS = 8_000;

/** Approximate supplies for Binance fallback (price × supply ≈ mkt cap). */
const BINANCE_FALLBACK: Array<{
  id: string;
  name: string;
  symbol: string;
  pair: string;
  image: string;
  circulating: number;
  totalSupply: number | null;
}> = [
  { id: "bitcoin", name: "Bitcoin", symbol: "BTC", pair: "BTCUSDT", image: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png", circulating: 19_900_000, totalSupply: 21_000_000 },
  { id: "ethereum", name: "Ethereum", symbol: "ETH", pair: "ETHUSDT", image: "https://assets.coingecko.com/coins/images/279/small/ethereum.png", circulating: 120_700_000, totalSupply: null },
  { id: "tether", name: "Tether", symbol: "USDT", pair: "USDT", image: "https://assets.coingecko.com/coins/images/325/small/Tether.png", circulating: 160_000_000_000, totalSupply: 160_000_000_000 },
  { id: "ripple", name: "XRP", symbol: "XRP", pair: "XRPUSDT", image: "https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png", circulating: 59_000_000_000, totalSupply: 100_000_000_000 },
  { id: "binancecoin", name: "BNB", symbol: "BNB", pair: "BNBUSDT", image: "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png", circulating: 144_000_000, totalSupply: 144_000_000 },
  { id: "solana", name: "Solana", symbol: "SOL", pair: "SOLUSDT", image: "https://assets.coingecko.com/coins/images/4128/small/solana.png", circulating: 540_000_000, totalSupply: null },
  { id: "usd-coin", name: "USDC", symbol: "USDC", pair: "USDCUSDT", image: "https://assets.coingecko.com/coins/images/6319/small/usdc.png", circulating: 60_000_000_000, totalSupply: 60_000_000_000 },
  { id: "cardano", name: "Cardano", symbol: "ADA", pair: "ADAUSDT", image: "https://assets.coingecko.com/coins/images/975/small/cardano.png", circulating: 35_000_000_000, totalSupply: 45_000_000_000 },
  { id: "dogecoin", name: "Dogecoin", symbol: "DOGE", pair: "DOGEUSDT", image: "https://assets.coingecko.com/coins/images/5/small/dogecoin.png", circulating: 150_000_000_000, totalSupply: null },
  { id: "tron", name: "TRON", symbol: "TRX", pair: "TRXUSDT", image: "https://assets.coingecko.com/coins/images/1094/small/tron-logo.png", circulating: 86_000_000_000, totalSupply: null },
  { id: "avalanche-2", name: "Avalanche", symbol: "AVAX", pair: "AVAXUSDT", image: "https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png", circulating: 420_000_000, totalSupply: 720_000_000 },
  { id: "shiba-inu", name: "Shiba Inu", symbol: "SHIB", pair: "SHIBUSDT", image: "https://assets.coingecko.com/coins/images/11939/small/shiba.png", circulating: 589_000_000_000_000, totalSupply: null },
  { id: "polkadot", name: "Polkadot", symbol: "DOT", pair: "DOTUSDT", image: "https://assets.coingecko.com/coins/images/12171/small/polkadot.png", circulating: 1_500_000_000, totalSupply: null },
  { id: "chainlink", name: "Chainlink", symbol: "LINK", pair: "LINKUSDT", image: "https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png", circulating: 650_000_000, totalSupply: 1_000_000_000 },
  { id: "bitcoin-cash", name: "Bitcoin Cash", symbol: "BCH", pair: "BCHUSDT", image: "https://assets.coingecko.com/coins/images/780/small/bitcoin-cash-circle.png", circulating: 19_800_000, totalSupply: 21_000_000 },
  { id: "litecoin", name: "Litecoin", symbol: "LTC", pair: "LTCUSDT", image: "https://assets.coingecko.com/coins/images/2/small/litecoin.png", circulating: 75_000_000, totalSupply: 84_000_000 },
  { id: "uniswap", name: "Uniswap", symbol: "UNI", pair: "UNIUSDT", image: "https://assets.coingecko.com/coins/images/12504/small/uni.jpg", circulating: 600_000_000, totalSupply: 1_000_000_000 },
  { id: "near", name: "NEAR Protocol", symbol: "NEAR", pair: "NEARUSDT", image: "https://assets.coingecko.com/coins/images/10365/small/near.jpg", circulating: 1_200_000_000, totalSupply: null },
  { id: "stellar", name: "Stellar", symbol: "XLM", pair: "XLMUSDT", image: "https://assets.coingecko.com/coins/images/100/small/Stellar_symbol_black_RGB.png", circulating: 31_000_000_000, totalSupply: 50_000_000_000 },
  { id: "aptos", name: "Aptos", symbol: "APT", pair: "APTUSDT", image: "https://assets.coingecko.com/coins/images/26455/small/aptos_round.png", circulating: 700_000_000, totalSupply: null },
  { id: "hedera-hashgraph", name: "Hedera", symbol: "HBAR", pair: "HBARUSDT", image: "https://assets.coingecko.com/coins/images/3441/small/Hedera_Hashgraph_logo.png", circulating: 42_000_000_000, totalSupply: 50_000_000_000 },
  { id: "internet-computer", name: "Internet Computer", symbol: "ICP", pair: "ICPUSDT", image: "https://assets.coingecko.com/coins/images/14495/small/Internet_Computer_logo.png", circulating: 530_000_000, totalSupply: null },
  { id: "filecoin", name: "Filecoin", symbol: "FIL", pair: "FILUSDT", image: "https://assets.coingecko.com/coins/images/12817/small/filecoin.png", circulating: 700_000_000, totalSupply: null },
  { id: "arbitrum", name: "Arbitrum", symbol: "ARB", pair: "ARBUSDT", image: "https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-26_20-50-56.jpg", circulating: 4_000_000_000, totalSupply: 10_000_000_000 },
  { id: "vechain", name: "VeChain", symbol: "VET", pair: "VETUSDT", image: "https://assets.coingecko.com/coins/images/1167/small/VET_Token_Icon.png", circulating: 81_000_000_000, totalSupply: 86_000_000_000 },
  { id: "cosmos", name: "Cosmos Hub", symbol: "ATOM", pair: "ATOMUSDT", image: "https://assets.coingecko.com/coins/images/1481/small/cosmos_hub.png", circulating: 390_000_000, totalSupply: null },
  { id: "render-token", name: "Render", symbol: "RENDER", pair: "RENDERUSDT", image: "https://assets.coingecko.com/coins/images/11636/small/rndr.png", circulating: 530_000_000, totalSupply: null },
  { id: "injective-protocol", name: "Injective", symbol: "INJ", pair: "INJUSDT", image: "https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png", circulating: 97_000_000, totalSupply: null },
  { id: "optimism", name: "Optimism", symbol: "OP", pair: "OPUSDT", image: "https://assets.coingecko.com/coins/images/25244/small/Optimism.png", circulating: 1_700_000_000, totalSupply: 4_300_000_000 },
  { id: "mantle", name: "Mantle", symbol: "MNT", pair: "MNTUSDT", image: "https://assets.coingecko.com/coins/images/30980/small/token-logo.png", circulating: 3_300_000_000, totalSupply: 6_200_000_000 },
];

type MarketsCache = {
  at: number;
  rows: MarketRow[];
  rich: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __nexoraMarketsCache: MarketsCache | undefined;
  // eslint-disable-next-line no-var
  var __nexoraMarketsInflight: Promise<MarketRow[]> | undefined;
  // eslint-disable-next-line no-var
  var __nexoraMarketsMeta: Map<string, MarketRow> | undefined;
}

function raceTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function mapCoinGecko(data: CoinGeckoMarket[]): MarketRow[] {
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

function rememberMeta(rows: MarketRow[]) {
  if (!globalThis.__nexoraMarketsMeta) globalThis.__nexoraMarketsMeta = new Map();
  for (const row of rows) {
    if (row.marketCap != null || row.circulating != null) {
      globalThis.__nexoraMarketsMeta.set(row.id, row);
    }
  }
}

function enrichFromMeta(rows: MarketRow[]): MarketRow[] {
  const meta = globalThis.__nexoraMarketsMeta;
  if (!meta?.size) return rows;
  return rows.map((row) => {
    const prev = meta.get(row.id);
    if (!prev) return row;
    return {
      ...row,
      marketCap: row.marketCap ?? prev.marketCap,
      fdv: row.fdv ?? prev.fdv,
      circulating: row.circulating ?? prev.circulating,
      totalSupply: row.totalSupply ?? prev.totalSupply,
      image: row.image || prev.image,
    };
  });
}

async function fetchFromCoinGecko(limit: number): Promise<MarketRow[]> {
  const url = new URL("https://api.coingecko.com/api/v3/coins/markets");
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("order", "market_cap_desc");
  url.searchParams.set("per_page", String(limit));
  url.searchParams.set("page", "1");
  url.searchParams.set("sparkline", "false");
  url.searchParams.set("price_change_percentage", "24h");

  return raceTimeout(
    (async () => {
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      const data = (await res.json()) as CoinGeckoMarket[];
      if (!Array.isArray(data) || data.length === 0) throw new Error("CoinGecko empty");
      const rows = mapCoinGecko(data);
      rememberMeta(rows);
      return rows;
    })(),
    UPSTREAM_TIMEOUT_MS,
    "CoinGecko",
  );
}

async function fetchFromBinance(limit: number): Promise<MarketRow[]> {
  return raceTimeout(
    (async () => {
      const res = await fetch("https://api.binance.com/api/v3/ticker/24hr", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Binance ${res.status}`);
      const tickers = (await res.json()) as BinanceTicker[];
      const byPair = new Map(tickers.map((t) => [t.symbol, t]));

      const rows: MarketRow[] = [];
      for (const coin of BINANCE_FALLBACK) {
        if (rows.length >= limit) break;

        const price =
          coin.symbol === "USDT" ? 1 : Number(byPair.get(coin.pair)?.lastPrice) || null;
        if (price == null && coin.symbol !== "USDT") continue;

        const t = coin.symbol === "USDT" ? null : byPair.get(coin.pair);
        const marketCap = price != null ? price * coin.circulating : null;
        const total = coin.totalSupply;
        const fdv = price != null && total != null ? price * total : marketCap;

        rows.push({
          id: coin.id,
          name: coin.name,
          symbol: coin.symbol,
          image: coin.image,
          marketCap,
          fdv,
          price,
          circulating: coin.circulating,
          totalSupply: total ?? coin.circulating,
          volume: t ? Number(t.quoteVolume) || null : null,
          change24h: t ? Number(t.priceChangePercent) || null : 0,
        });
      }
      if (rows.length === 0) throw new Error("Binance empty");
      return enrichFromMeta(rows);
    })(),
    UPSTREAM_TIMEOUT_MS,
    "Binance",
  );
}

async function fetchUpstream(limit: number): Promise<MarketRow[]> {
  try {
    return await fetchFromCoinGecko(limit);
  } catch {
    return await fetchFromBinance(limit);
  }
}

export async function fetchLiveMarkets(limit = 25): Promise<MarketRow[]> {
  const cached = globalThis.__nexoraMarketsCache;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS && cached.rows.length > 0) {
    return cached.rows.slice(0, limit);
  }

  if (!globalThis.__nexoraMarketsInflight) {
    globalThis.__nexoraMarketsInflight = fetchUpstream(Math.max(limit, 30))
      .then((rows) => {
        const rich = rows.some((r) => r.marketCap != null && r.circulating != null);
        globalThis.__nexoraMarketsCache = { at: Date.now(), rows, rich };
        return rows;
      })
      .finally(() => {
        globalThis.__nexoraMarketsInflight = undefined;
      });
  }

  try {
    const rows = await globalThis.__nexoraMarketsInflight;
    return rows.slice(0, limit);
  } catch (err) {
    if (cached?.rows.length) {
      return cached.rows.slice(0, limit);
    }
    throw err;
  }
}

export function marketsCacheAgeMs(): number | null {
  const cached = globalThis.__nexoraMarketsCache;
  if (!cached) return null;
  return Date.now() - cached.at;
}
