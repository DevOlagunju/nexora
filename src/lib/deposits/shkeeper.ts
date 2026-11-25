import { hmacHex, safeEqual } from "@/lib/crypto";
import type { DepositEvent, DepositProvider } from "@/lib/deposits/provider";

/**
 * SHKeeper (https://shkeeper.io): free, open-source, self-hosted crypto payment processor. You run
 * it on your own server; it holds the wallet keys, gives out deposit addresses and calls Nexora back
 * when crypto arrives. docs/DEPOSITS.md explains the setup.
 *
 * Mapping to Nexora: each customer's address for one asset on one network is a permanent SHKeeper
 * "invoice" whose external_id is nexora:<userId>:<symbol>:<network>. SHKeeper returns the same address
 * every time it is asked for the same external_id. Nexora ignores SHKeeper's invoice status
 * (PAID/PARTIAL/...) and matches each transaction to the customer's open sell order itself.
 *
 * Trust: a callback is acted on only when its HMAC signature and timestamp check out, and each
 * transaction is then looked up through SHKeeper's own API and must show as CONFIRMED there.
 */

/** SHKeeper's coin names. Check them against GET <SHKEEPER_URL>/api/v1/crypto on your install. */
const DEFAULT_CRYPTOS: Record<string, string> = {
  "BTC/BTC": "BTC",
  "ETH/ERC20": "ETH",
  "USDT/ERC20": "ETH-USDT",
  "USDC/ERC20": "ETH-USDC",
  "BNB/BEP20": "BNB",
  "USDT/BEP20": "BNB-USDT",
  "USDC/BEP20": "BNB-USDC",
  "TRX/TRC20": "TRX",
  "USDT/TRC20": "USDT",
  "USDC/TRC20": "USDC",
};

/** Maximum age of a signed callback, as SHKeeper's verification guide recommends. */
export const SHKEEPER_MAX_AGE_SECONDS = 300;

export type ShkeeperConfig = {
  url: string;
  apiKey: string;
  webhookSecret: string;
  callbackUrl: string;
  cryptos: Record<string, string>;
};

/**
 * SHKEEPER_CRYPTO_NAMES adds to or overrides the coin names, as "SYMBOL/NETWORK=NAME" pairs separated
 * by commas, e.g. "USDT/TRC20=USDT-TRC20,SOL/SOL=SOL".
 */
export function parseCryptoNames(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_CRYPTOS };
  for (const pair of (raw ?? "").split(",")) {
    const [key, name] = pair.split("=").map((s) => s?.trim());
    if (!key || !name || !/^[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(key)) continue;
    out[key.toUpperCase()] = name;
  }
  return out;
}

/** Null until SHKEEPER_URL, SHKEEPER_API_KEY and NEXT_PUBLIC_APP_URL are all set. */
export function shkeeperConfig(env: Record<string, string | undefined> = process.env): ShkeeperConfig | null {
  const url = env.SHKEEPER_URL?.trim().replace(/\/+$/, "");
  const apiKey = env.SHKEEPER_API_KEY?.trim();
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!url || !apiKey || !appUrl) return null;
  return {
    url,
    apiKey,
    // SHKeeper's guide signs with the API key in one example and a "webhook secret" in another.
    webhookSecret: env.SHKEEPER_WEBHOOK_SECRET?.trim() || apiKey,
    callbackUrl: `${appUrl}/api/v1/webhooks/shkeeper`,
    cryptos: parseCryptoNames(env.SHKEEPER_CRYPTO_NAMES),
  };
}

export function shkeeperCryptoFor(cfg: Pick<ShkeeperConfig, "cryptos">, symbol: string, network: string): string | null {
  return cfg.cryptos[`${symbol.toUpperCase()}/${network.toUpperCase()}`] ?? null;
}

export function assetForShkeeperCrypto(cfg: Pick<ShkeeperConfig, "cryptos">, crypto: string): { symbol: string; network: string } | null {
  for (const [key, name] of Object.entries(cfg.cryptos)) {
    if (name.toUpperCase() === crypto.toUpperCase()) {
      const [symbol, network] = key.split("/");
      return { symbol, network };
    }
  }
  return null;
}

export const shkeeperExternalId = (userId: string, symbol: string, network: string) =>
  `nexora:${userId}:${symbol.toUpperCase()}:${network.toUpperCase()}`;

/** HMAC-SHA256 over "<timestamp>.<raw body>", lower-case hex, as SHKeeper signs callbacks. */
export function signShkeeperCallback(secret: string, timestamp: string, rawBody: string): string {
  return hmacHex("sha256", secret, `${timestamp}.${rawBody}`);
}

export function verifyShkeeperSignature(
  secret: string,
  rawBody: string,
  headers: Pick<Headers, "get">,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const timestamp = headers.get("x-shkeeper-timestamp")?.trim() ?? "";
  const signature = headers.get("x-shkeeper-signature")?.trim().toLowerCase() ?? "";
  if (!secret || !/^\d{1,12}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > SHKEEPER_MAX_AGE_SECONDS) return false;
  return safeEqual(signShkeeperCallback(secret, timestamp, rawBody), signature);
}

type CallbackTx = { txid?: unknown; amount_crypto?: unknown; crypto?: unknown };
type CallbackBody = { external_id?: unknown; crypto?: unknown; addr?: unknown; transactions?: unknown };

/** One event per transaction in the callback. SHKeeper repeats earlier ones; they are recognised by id. */
export function parseShkeeperCallback(cfg: Pick<ShkeeperConfig, "cryptos">, rawBody: string): DepositEvent[] {
  const body = JSON.parse(rawBody) as CallbackBody;
  const externalId = String(body.external_id ?? "");
  const addr = String(body.addr ?? "");
  if (!addr) throw new Error("SHKeeper callback has no addr");
  if (!Array.isArray(body.transactions)) throw new Error("SHKeeper callback has no transactions");

  return (body.transactions as CallbackTx[]).map((tx) => {
    const crypto = String(tx.crypto ?? body.crypto ?? "");
    const asset = assetForShkeeperCrypto(cfg, crypto);
    if (!asset) throw new Error(`SHKeeper coin "${crypto}" is not mapped to an asset and network (SHKEEPER_CRYPTO_NAMES)`);
    const txid = String(tx.txid ?? "");
    if (!txid) throw new Error("SHKeeper transaction has no txid");
    return {
      eventId: `${crypto}:${txid}`,
      network: asset.network,
      symbol: asset.symbol,
      txHash: txid,
      txIndex: "0",
      toAddress: addr,
      fromAddress: null,
      amount: Number(tx.amount_crypto),
      confirmations: 0,
      providerRef: externalId,
      providerCoin: crypto,
    };
  });
}

type InvoicesResponse = { status?: string; invoices?: Array<{ txs?: Array<{ txid?: string; status?: string; amount?: string; addr?: string; crypto?: string }> }> };

async function shkeeperFetch<T>(cfg: ShkeeperConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${cfg.url}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "X-Shkeeper-Api-Key": cfg.apiKey, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`SHKeeper ${path} answered ${res.status} with something that is not JSON`);
  }
  if (!res.ok) throw new Error(`SHKeeper ${path} answered ${res.status}: ${text.slice(0, 200)}`);
  return json as T;
}

export function shkeeperProvider(cfg: ShkeeperConfig): DepositProvider {
  return {
    name: "shkeeper",
    successStatus: 202,

    async createAddress({ userId, symbol, networkCode }) {
      const crypto = shkeeperCryptoFor(cfg, symbol, networkCode);
      if (!crypto) throw new Error(`SHKeeper has no coin set up for ${symbol} on ${networkCode} (SHKEEPER_CRYPTO_NAMES)`);
      const externalId = shkeeperExternalId(userId, symbol, networkCode);
      const res = await shkeeperFetch<{ status?: string; wallet?: string; message?: string }>(cfg, `/api/v1/${encodeURIComponent(crypto)}/payment_request`, {
        method: "POST",
        // The amount is nominal: this address is the customer's for good, and Nexora matches each
        // deposit to an order itself.
        body: JSON.stringify({ external_id: externalId, fiat: "USD", amount: "1", callback_url: cfg.callbackUrl }),
      });
      if (res.status !== "success" || !res.wallet) throw new Error(`SHKeeper refused the address request: ${res.message ?? res.status ?? "no reason given"}`);
      return { address: res.wallet, providerRef: externalId };
    },

    verifyWebhook(rawBody, headers) {
      return verifyShkeeperSignature(cfg.webhookSecret, rawBody, headers);
    },

    parseWebhook(rawBody) {
      return parseShkeeperCallback(cfg, rawBody);
    },

    /** Looks the transaction up in SHKeeper itself; only a CONFIRMED one there counts. */
    async confirmEvent(e) {
      if (!e.providerRef) throw new Error("SHKeeper event has no external_id to check against");
      const res = await shkeeperFetch<InvoicesResponse>(cfg, `/api/v1/invoices/${encodeURIComponent(e.providerRef)}`);
      const tx = (res.invoices ?? []).flatMap((i) => i.txs ?? []).find((t) => t.txid === e.txHash && (!t.crypto || t.crypto === e.providerCoin));
      if (!tx) throw new Error(`SHKeeper does not know transaction ${e.txHash} on ${e.providerRef}`);
      if (String(tx.status ?? "").toUpperCase() !== "CONFIRMED") {
        // Not yet: failing makes SHKeeper deliver the callback again a minute later.
        throw new Error(`SHKeeper shows ${e.txHash} as ${tx.status ?? "unknown"}, not CONFIRMED yet`);
      }
      // SHKeeper's own figures win over the callback's.
      return { ...e, amount: tx.amount !== undefined ? Number(tx.amount) : e.amount, toAddress: tx.addr || e.toAddress, confirmed: true };
    },
  };
}
