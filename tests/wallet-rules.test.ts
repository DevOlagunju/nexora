import { describe, expect, it } from "vitest";
import {
  maxWithdrawable,
  pinProblem,
  quoteWithdrawal,
  referralEarned,
  walletConfig,
} from "@/lib/wallet-rules";
import { alertHit, formatDuration, medianMinutes } from "@/lib/alert-rules";
import { cryptoBuySchema, cryptoSellSchema } from "@/lib/validators";

const cfg = walletConfig({});

describe("walletConfig", () => {
  it("has safe defaults and ignores junk env", () => {
    expect(cfg.minWithdrawalNgn).toBe(1_000);
    expect(cfg.withdrawalFeeNgn).toBe(100);
    expect(walletConfig({ WALLET_WITHDRAWAL_FEE_NGN: "-5" }).withdrawalFeeNgn).toBe(100);
    expect(walletConfig({ WALLET_WITHDRAWAL_FEE_NGN: "0" }).withdrawalFeeNgn).toBe(0);
  });
});

describe("quoteWithdrawal", () => {
  it("charges the fee on top so the customer receives the exact amount", () => {
    expect(quoteWithdrawal(5_000, 10_000, cfg)).toEqual({ ok: true, amountNgn: 5_000, feeNgn: 100, totalNgn: 5_100 });
  });
  it("refuses when amount + fee exceeds the balance", () => {
    const q = quoteWithdrawal(10_000, 10_000, cfg);
    expect(q.ok).toBe(false);
  });
  it("enforces min and max", () => {
    expect(quoteWithdrawal(999, 50_000, cfg).ok).toBe(false);
    expect(quoteWithdrawal(cfg.maxWithdrawalNgn + 1, 1e9, cfg).ok).toBe(false);
    expect(quoteWithdrawal(Number.NaN, 50_000, cfg).ok).toBe(false);
  });
  it("rounds to kobo", () => {
    const q = quoteWithdrawal(1_000.005, 5_000, cfg);
    expect(q.ok && q.amountNgn).toBe(1_000.01);
  });
  it("maxWithdrawable leaves room for the fee", () => {
    expect(maxWithdrawable(10_000, cfg)).toBe(9_900);
    expect(maxWithdrawable(20, cfg)).toBe(0);
  });
});

describe("pinProblem", () => {
  it.each(["0000", "1111", "1234", "4321", "6789", "123", "12a4", "12345"])("rejects %s", (pin) => {
    expect(pinProblem(pin)).not.toBeNull();
  });
  it.each(["2580", "1357", "9024"])("accepts %s", (pin) => {
    expect(pinProblem(pin)).toBeNull();
  });
});

describe("referralEarned", () => {
  it("pays only after the threshold", () => {
    expect(referralEarned(19_999, cfg)).toBe(false);
    expect(referralEarned(20_000, cfg)).toBe(true);
    expect(referralEarned(1e9, walletConfig({ REFERRAL_BONUS_NGN: "0" }))).toBe(false);
  });
});

describe("order schemas", () => {
  it("accept any well-formed asset code: which ones trade is decided by the registry", () => {
    const r = cryptoBuySchema.safeParse({ symbol: "sol", amountCrypto: 10, userReceiveAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE" });
    expect(r.success && r.data.symbol).toBe("SOL");
    expect(r.success && r.data.payFrom).toBe("BANK");
    expect(r.success && r.data.network).toBeUndefined();
  });
  it("normalise an optional network and treat an empty one as none", () => {
    expect(cryptoSellSchema.safeParse({ symbol: "USDT", network: "bep20", amountCrypto: 1 }).data?.network).toBe("BEP20");
    expect(cryptoSellSchema.safeParse({ symbol: "USDT", network: "", amountCrypto: 1 }).data?.network).toBeUndefined();
  });
  it("reject codes that are not codes", () => {
    expect(cryptoSellSchema.safeParse({ symbol: "US DT", amountCrypto: 1 }).success).toBe(false);
    expect(cryptoSellSchema.safeParse({ symbol: "USDT", network: "TRC 20; DROP", amountCrypto: 1 }).success).toBe(false);
  });
});

describe("payout defaults", () => {
  it("sell proceeds default to the wallet", () => {
    const r = cryptoSellSchema.safeParse({ symbol: "USDT", amountCrypto: 10 });
    expect(r.success && r.data.payoutMethod).toBe("WALLET");
  });
});

describe("rate alerts + desk speed", () => {
  it("alertHit respects direction and is inclusive", () => {
    expect(alertHit("ABOVE", 1_450, 1_450)).toBe(true);
    expect(alertHit("ABOVE", 1_450, 1_449)).toBe(false);
    expect(alertHit("BELOW", 1_300, 1_299)).toBe(true);
    expect(alertHit("BELOW", 1_300, 1_301)).toBe(false);
  });
  it("medianMinutes ignores bad values", () => {
    expect(medianMinutes([])).toBeNull();
    expect(medianMinutes([10 * 60_000, 20 * 60_000, NaN, -5])).toBe(15);
    expect(medianMinutes([5 * 60_000, 7 * 60_000, 60 * 60_000])).toBe(7);
  });
  it("formatDuration", () => {
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(42)).toBe("42 min");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(135)).toBe("2h 15m");
  });
});
