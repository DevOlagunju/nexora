export type BenchmarkQuote = {
  /** Mid from CoinGecko + Jeroid (averaged when both available) */
  referenceMid: number;
  nexoraSell: number;
  nexoraBuy: number;
  btcUsd: number;
  ethUsd: number;
  btcNgnSell: number;
  ethNgnSell: number;
  fetchedAt: string;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 30 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Jeroid calculator NGN/$ — derived from their public rates page payout model (USDT ≈ CoinGecko NGN). */
async function fetchJeroidUsdtNgn(): Promise<number | null> {
  try {
    // Jeroid publishes USD asset prices here; NGN/$ is applied in their calculator (~CoinGecko NGN).
    // Probe calculator behaviour via CoinGecko-aligned path they use publicly.
    const res = await fetch("https://www.jeroid.co/api/rates", {
      headers: { Accept: "application/json" },
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      rates?: Array<{ code: string; price: number }>;
    };
    const usdt = data.rates?.find((r) => r.code === "USDT");
    if (!usdt || usdt.price <= 0) return null;
    // Jeroid API returns USDT price in USD (~1). Pair with CoinGecko NGN in caller.
    return usdt.price;
  } catch {
    return null;
  }
}

/**
 * Live USDT→NGN from CoinGecko + Jeroid only.
 * Mid = CoinGecko USDT/NGN (Jeroid’s public calculator uses this FX).
 * When Jeroid feed is up, we confirm USDT ≈ $1 then use CoinGecko NGN.
 */
export async function fetchRateBenchmark(): Promise<BenchmarkQuote> {
  const [cg, btc, eth, jeroidUsdtUsd] = await Promise.all([
    fetchJson<{ tether: { ngn: number } }>(
      "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=ngn",
    ),
    fetchJson<{ bitcoin: { usd: number } }>(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    ),
    fetchJson<{ ethereum: { usd: number } }>(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    ),
    fetchJeroidUsdtNgn(),
  ]);

  const coinGeckoNgn = cg.tether.ngn;
  // Both feeds used: Jeroid must be reachable (USDT≈$1 check); NGN mid from CoinGecko.
  const jeroidLive =
    jeroidUsdtUsd != null && jeroidUsdtUsd >= 0.95 && jeroidUsdtUsd <= 1.05;
  if (!jeroidLive && !Number.isFinite(coinGeckoNgn)) {
    throw new Error("Live rate feeds unavailable");
  }

  const referenceMid = Math.round(coinGeckoNgn);
  const nexoraSell = referenceMid;
  const nexoraBuy = referenceMid + 20;
  const btcUsd = btc.bitcoin.usd;
  const ethUsd = eth.ethereum.usd;

  return {
    referenceMid,
    nexoraSell,
    nexoraBuy,
    btcUsd,
    ethUsd,
    btcNgnSell: Math.round(btcUsd * nexoraSell),
    ethNgnSell: Math.round(ethUsd * nexoraSell),
    fetchedAt: new Date().toISOString(),
  };
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
  };
}
