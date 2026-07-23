export type BenchmarkQuote = {
  /** Mid USDT/NGN used for desk pricing */
  referenceMid: number;
  nexoraSell: number;
  nexoraBuy: number;
  btcUsd: number;
  ethUsd: number;
  btcNgnSell: number;
  ethNgnSell: number;
  fetchedAt: string;
  source: string;
};

const CACHE_TTL_MS = 90_000;

declare global {
  // eslint-disable-next-line no-var
  var __nexoraRateBenchmarkCache: { at: number; quote: BenchmarkQuote } | undefined;
  // Shared with markets-live.ts when that module has loaded
  // eslint-disable-next-line no-var
  var __nexoraMarketsCache:
    | {
        at: number;
        rows: Array<{ id: string; price: number | null }>;
      }
    | undefined;
}

function raceTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function fetchJson<T>(url: string, label: string, timeoutMs = 6_000): Promise<T> {
  const res = await raceTimeout(
    fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    }),
    timeoutMs,
    label,
  );
  if (res.status === 429) throw new Error(`${label} busy`);
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function buildQuote(input: {
  mid: number;
  btcUsd: number;
  ethUsd: number;
  source: string;
}): BenchmarkQuote {
  const referenceMid = Math.round(input.mid);
  const nexoraSell = referenceMid;
  const nexoraBuy = referenceMid + 20;
  return {
    referenceMid,
    nexoraSell,
    nexoraBuy,
    btcUsd: input.btcUsd,
    ethUsd: input.ethUsd,
    btcNgnSell: Math.round(input.btcUsd * nexoraSell),
    ethNgnSell: Math.round(input.ethUsd * nexoraSell),
    fetchedAt: new Date().toISOString(),
    source: input.source,
  };
}

function pricesFromMarketsCache(): { btcUsd: number; ethUsd: number } | null {
  const rows = globalThis.__nexoraMarketsCache?.rows;
  if (!rows?.length) return null;
  const btc = rows.find((r) => r.id === "bitcoin")?.price;
  const eth = rows.find((r) => r.id === "ethereum")?.price;
  if (btc == null || eth == null || btc <= 0 || eth <= 0) return null;
  return { btcUsd: btc, ethUsd: eth };
}

async function fetchUsdFromCoinbase(): Promise<{ btcUsd: number; ethUsd: number }> {
  type Spot = { data?: { amount?: string } };
  const [btc, eth] = await Promise.all([
    fetchJson<Spot>("https://api.coinbase.com/v2/prices/BTC-USD/spot", "Coinbase"),
    fetchJson<Spot>("https://api.coinbase.com/v2/prices/ETH-USD/spot", "Coinbase"),
  ]);
  const btcUsd = Number(btc.data?.amount);
  const ethUsd = Number(eth.data?.amount);
  if (!Number.isFinite(btcUsd) || !Number.isFinite(ethUsd)) throw new Error("Coinbase invalid");
  return { btcUsd, ethUsd };
}

async function fetchUsdFromBinance(): Promise<{ btcUsd: number; ethUsd: number }> {
  type Ticker = { lastPrice?: string };
  // data-api mirrors are less geo-blocked than api.binance.com in some regions
  const [btc, eth] = await Promise.all([
    fetchJson<Ticker>(
      "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT",
      "Binance",
      5_000,
    ),
    fetchJson<Ticker>(
      "https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDT",
      "Binance",
      5_000,
    ),
  ]);
  const btcUsd = Number(btc.lastPrice);
  const ethUsd = Number(eth.lastPrice);
  if (!Number.isFinite(btcUsd) || !Number.isFinite(ethUsd)) throw new Error("Binance invalid");
  return { btcUsd, ethUsd };
}

async function fetchUsdtNgnCoinGecko(): Promise<number> {
  type Cg = { tether?: { ngn?: number } };
  const cg = await fetchJson<Cg>(
    "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=ngn",
    "CoinGecko",
    5_000,
  );
  const ngn = cg.tether?.ngn;
  if (!ngn || !Number.isFinite(ngn)) throw new Error("CoinGecko missing NGN");
  return ngn;
}

async function fetchFullCoinGecko(): Promise<BenchmarkQuote> {
  type Cg = {
    tether?: { ngn?: number };
    bitcoin?: { usd?: number };
    ethereum?: { usd?: number };
  };
  const cg = await fetchJson<Cg>(
    "https://api.coingecko.com/api/v3/simple/price?ids=tether,bitcoin,ethereum&vs_currencies=usd,ngn",
    "CoinGecko",
    6_000,
  );
  if (!cg.tether?.ngn || !cg.bitcoin?.usd || !cg.ethereum?.usd) {
    throw new Error("CoinGecko incomplete");
  }
  return buildQuote({
    mid: cg.tether.ngn,
    btcUsd: cg.bitcoin.usd,
    ethUsd: cg.ethereum.usd,
    source: "coingecko",
  });
}

async function resolveUsdPair(hints?: {
  btcUsd?: number;
  ethUsd?: number;
}): Promise<{ btcUsd: number; ethUsd: number; via: string }> {
  const cached = pricesFromMarketsCache();
  if (cached) return { ...cached, via: "markets-cache" };

  const attempts = [fetchUsdFromCoinbase, fetchUsdFromBinance];
  for (const attempt of attempts) {
    try {
      const pair = await attempt();
      return { ...pair, via: attempt.name };
    } catch {
      /* try next */
    }
  }

  if (hints?.btcUsd && hints?.ethUsd && hints.btcUsd > 0 && hints.ethUsd > 0) {
    return { btcUsd: hints.btcUsd, ethUsd: hints.ethUsd, via: "desk-hint" };
  }

  throw new Error("Could not load BTC/ETH USD prices from any feed.");
}

/**
 * Admin "Sync live" - designed to survive CoinGecko HTTP 429.
 * Uses Coinbase / Binance / markets cache for USD; CoinGecko only for USDT/NGN (optional).
 */
export async function fetchReliableDeskBenchmark(options?: {
  ngnMidHint?: number;
  btcUsdHint?: number;
  ethUsdHint?: number;
}): Promise<BenchmarkQuote> {
  const ngnHint = options?.ngnMidHint;
  const { btcUsd, ethUsd, via: usdVia } = await resolveUsdPair({
    btcUsd: options?.btcUsdHint,
    ethUsd: options?.ethUsdHint,
  });

  let mid = ngnHint && ngnHint > 500 && ngnHint < 5000 ? ngnHint : 1380;
  let ngnVia = "desk-usdt";

  try {
    mid = await fetchUsdtNgnCoinGecko();
    ngnVia = "coingecko";
  } catch {
    /* keep desk USDT/NGN mid - do not fail the sync */
  }

  const quote = buildQuote({
    mid,
    btcUsd,
    ethUsd,
    source: `${usdVia}+${ngnVia}`,
  });
  globalThis.__nexoraRateBenchmarkCache = { at: Date.now(), quote };
  return quote;
}

/** Homepage / live card. */
export async function fetchRateBenchmark(ngnMidHint?: number): Promise<BenchmarkQuote> {
  const cached = globalThis.__nexoraRateBenchmarkCache;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.quote, source: "cache" };
  }

  try {
    const quote = await fetchFullCoinGecko();
    globalThis.__nexoraRateBenchmarkCache = { at: Date.now(), quote };
    return quote;
  } catch {
    if (cached?.quote) return { ...cached.quote, source: "cache" };
    return fetchReliableDeskBenchmark({ ngnMidHint });
  }
}

export function deskQuotesFromBenchmark(b: BenchmarkQuote) {
  return {
    USDT: { mid: b.referenceMid, sell: b.nexoraSell, buy: b.nexoraBuy },
    BTC: {
      mid: Math.round(b.btcUsd * b.referenceMid),
      sell: b.btcNgnSell,
      buy: Math.round(b.btcUsd * b.nexoraBuy),
    },
    ETH: {
      mid: Math.round(b.ethUsd * b.referenceMid),
      sell: b.ethNgnSell,
      buy: Math.round(b.ethUsd * b.nexoraBuy),
    },
    fetchedAt: b.fetchedAt,
    source: b.source,
  };
}
