import { describe, expect, it } from "vitest";
import {
  assetForShkeeperCrypto,
  parseCryptoNames,
  parseShkeeperCallback,
  shkeeperConfig,
  shkeeperCryptoFor,
  shkeeperExternalId,
  signShkeeperCallback,
  verifyShkeeperSignature,
} from "@/lib/deposits/shkeeper";
import { checkEnv } from "@/lib/env";

const SECRET = "shk-api-key";
const NOW = 1_780_000_000;

/** The callback body from SHKeeper's API documentation, with Nexora's external_id. */
const SAMPLE = JSON.stringify({
  external_id: "nexora:user1:USDT:ERC20",
  crypto: "ETH-USDT",
  addr: "0x6f2Fc9D7205B7D9037dDE45B5f9e12B18EA07e27",
  fiat: "USD",
  balance_fiat: "7.8",
  balance_crypto: "7.8",
  paid: true,
  status: "PAID",
  transactions: [
    {
      txid: "0xb7ab0a5e7ba0a5a8ec4a2cb7e0c8e7ab9b7d3d0b7ff8df1cd1b5d0b1e2d4a3f1",
      date: "2024-06-25 14:45:20",
      amount_crypto: "7.8",
      amount_fiat: "7.8",
      amount_fiat_without_fee: "7.8",
      fee_fiat: "0",
      trigger: true,
      crypto: "ETH-USDT",
    },
  ],
  fee_percent: "2",
  fee_fixed: "0",
  fee_policy: "PERCENT_FEE",
  overpaid_fiat: "0.00",
});

const signed = (body: string, ts = NOW, secret = SECRET) =>
  new Headers({ "X-Shkeeper-Timestamp": String(ts), "X-Shkeeper-Signature": signShkeeperCallback(secret, String(ts), body) });

describe("SHKeeper callback signatures", () => {
  it("accepts a callback signed with the secret over timestamp and raw body", () => {
    expect(verifyShkeeperSignature(SECRET, SAMPLE, signed(SAMPLE), NOW)).toBe(true);
    // Upper-case hex is the same signature.
    const h = signed(SAMPLE);
    h.set("X-Shkeeper-Signature", h.get("X-Shkeeper-Signature")!.toUpperCase());
    expect(verifyShkeeperSignature(SECRET, SAMPLE, h, NOW)).toBe(true);
  });

  it("refuses a wrong secret, a changed body, missing headers and an old or future timestamp", () => {
    expect(verifyShkeeperSignature(SECRET, SAMPLE, signed(SAMPLE, NOW, "other"), NOW)).toBe(false);
    expect(verifyShkeeperSignature(SECRET, SAMPLE.replace('"7.8"', '"78"'), signed(SAMPLE), NOW)).toBe(false);
    expect(verifyShkeeperSignature(SECRET, SAMPLE, new Headers(), NOW)).toBe(false);
    expect(verifyShkeeperSignature(SECRET, SAMPLE, signed(SAMPLE, NOW - 301), NOW)).toBe(false);
    expect(verifyShkeeperSignature(SECRET, SAMPLE, signed(SAMPLE, NOW + 301), NOW)).toBe(false);
    expect(verifyShkeeperSignature(SECRET, SAMPLE, signed(SAMPLE, NOW - 299), NOW)).toBe(true);
    expect(verifyShkeeperSignature("", SAMPLE, signed(SAMPLE, NOW, ""), NOW)).toBe(false);
  });
});

describe("SHKeeper callbacks", () => {
  const cfg = { cryptos: parseCryptoNames(undefined) };

  it("become one deposit event per transaction, keyed by coin and txid", () => {
    const [e, ...rest] = parseShkeeperCallback(cfg, SAMPLE);
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({
      eventId: "ETH-USDT:0xb7ab0a5e7ba0a5a8ec4a2cb7e0c8e7ab9b7d3d0b7ff8df1cd1b5d0b1e2d4a3f1",
      symbol: "USDT",
      network: "ERC20",
      toAddress: "0x6f2Fc9D7205B7D9037dDE45B5f9e12B18EA07e27",
      amount: 7.8,
      providerRef: "nexora:user1:USDT:ERC20",
      providerCoin: "ETH-USDT",
    });
    // Not trusted as confirmed until SHKeeper's API says so.
    expect(e.confirmed).toBeUndefined();
  });

  it("refuse a coin Nexora has no mapping for, and a body without transactions", () => {
    expect(() => parseShkeeperCallback(cfg, SAMPLE.replaceAll("ETH-USDT", "XMR"))).toThrow(/not mapped/);
    expect(() => parseShkeeperCallback(cfg, JSON.stringify({ addr: "x" }))).toThrow(/no transactions/);
  });
});

describe("SHKeeper coin names", () => {
  it("map Nexora's asset and network to SHKeeper's coin and back", () => {
    const cfg = { cryptos: parseCryptoNames(undefined) };
    expect(shkeeperCryptoFor(cfg, "usdt", "trc20")).toBe("USDT");
    expect(shkeeperCryptoFor(cfg, "USDT", "BEP20")).toBe("BNB-USDT");
    expect(shkeeperCryptoFor(cfg, "BTC", "BTC")).toBe("BTC");
    expect(shkeeperCryptoFor(cfg, "SOL", "SOL")).toBeNull();
    expect(assetForShkeeperCrypto(cfg, "ETH-USDC")).toEqual({ symbol: "USDC", network: "ERC20" });
  });

  it("can be added to or changed from the environment", () => {
    const cfg = { cryptos: parseCryptoNames("sol/sol=SOL, USDT/TRC20=TRON-USDT, junk, =x") };
    expect(shkeeperCryptoFor(cfg, "SOL", "SOL")).toBe("SOL");
    expect(shkeeperCryptoFor(cfg, "USDT", "TRC20")).toBe("TRON-USDT");
    expect(shkeeperCryptoFor(cfg, "BTC", "BTC")).toBe("BTC");
  });

  it("give each customer one permanent invoice id per asset and network", () => {
    expect(shkeeperExternalId("u1", "usdt", "trc20")).toBe("nexora:u1:USDT:TRC20");
  });
});

describe("SHKeeper configuration", () => {
  const full = { SHKEEPER_URL: "https://pay.example.com/", SHKEEPER_API_KEY: "k", NEXT_PUBLIC_APP_URL: "https://nexora.example.com/" };

  it("is off until the server, key and public URL are all set", () => {
    expect(shkeeperConfig({})).toBeNull();
    expect(shkeeperConfig({ ...full, SHKEEPER_API_KEY: "" })).toBeNull();
    expect(shkeeperConfig({ ...full, NEXT_PUBLIC_APP_URL: undefined })).toBeNull();
    expect(shkeeperConfig(full)).toMatchObject({
      url: "https://pay.example.com",
      webhookSecret: "k",
      callbackUrl: "https://nexora.example.com/api/v1/webhooks/shkeeper",
    });
    expect(shkeeperConfig({ ...full, SHKEEPER_WEBHOOK_SECRET: "s" })?.webhookSecret).toBe("s");
  });

  it("is checked at boot", () => {
    const base = { NODE_ENV: "production", DATABASE_URL: "postgresql://x", AUTH_SECRET: "a".repeat(40), ENCRYPTION_KEY: "ab".repeat(32) };
    const errorsOf = (extra: Record<string, string>) => checkEnv({ ...base, ...extra }).errors.join("\n");

    expect(errorsOf({ DEPOSIT_PROVIDER: "shkeeper" })).toMatch(/needs SHKEEPER_URL and SHKEEPER_API_KEY/);
    expect(errorsOf({ DEPOSIT_PROVIDER: "shkeeper", ...full, SHKEEPER_URL: "http://pay.example.com" })).toMatch(/must be https/);
    expect(errorsOf({ DEPOSIT_PROVIDER: "shkeeper", ...full })).not.toMatch(/SHKEEPER|DEPOSIT_PROVIDER/);
    expect(errorsOf({ DEPOSIT_PROVIDER: "blockradar" })).toMatch(/not one of/);
    // Outside production a missing setting is a warning, not a refusal to start.
    const dev = checkEnv({ ...base, NODE_ENV: "development", DEPOSIT_PROVIDER: "shkeeper" });
    expect(dev.errors).toEqual([]);
    expect(dev.warnings.join("\n")).toMatch(/SHKEEPER_URL/);
  });
});
