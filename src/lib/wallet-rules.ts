/**
 * Pure wallet rules (no DB). Unit tested in tests/wallet-rules.test.ts.
 * Amounts are NGN floats, rounded with roundNgn at every boundary.
 */
import { addNgn, roundNgn, subNgn } from "@/lib/money";

export type WalletConfig = {
  minWithdrawalNgn: number;
  maxWithdrawalNgn: number;
  /** Flat fee per withdrawal, charged on top so the customer receives the exact amount asked. */
  withdrawalFeeNgn: number;
  /** Paid to the referrer once, when the referred customer's completed sells reach referralMinTradeNgn. */
  referralBonusNgn: number;
  referralMinTradeNgn: number;
  pinMaxAttempts: number;
  pinLockMinutes: number;
};

function num(raw: string | undefined, fallback: number, min = 0) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export function walletConfig(env: Record<string, string | undefined> = process.env): WalletConfig {
  return {
    minWithdrawalNgn: num(env.WALLET_MIN_WITHDRAWAL_NGN, 1_000, 1),
    maxWithdrawalNgn: num(env.WALLET_MAX_WITHDRAWAL_NGN, 2_000_000, 1),
    withdrawalFeeNgn: num(env.WALLET_WITHDRAWAL_FEE_NGN, 50),
    referralBonusNgn: num(env.REFERRAL_BONUS_NGN, 1_000),
    referralMinTradeNgn: num(env.REFERRAL_MIN_TRADE_NGN, 20_000),
    pinMaxAttempts: 5,
    pinLockMinutes: 30,
  };
}

export type WithdrawalQuote =
  | { ok: true; amountNgn: number; feeNgn: number; totalNgn: number }
  | { ok: false; error: string };

export function quoteWithdrawal(amount: number, balance: number, cfg: WalletConfig): WithdrawalQuote {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Enter an amount to withdraw." };
  const amountNgn = roundNgn(amount);
  if (amountNgn < cfg.minWithdrawalNgn) {
    return { ok: false, error: `Minimum withdrawal is ₦${cfg.minWithdrawalNgn.toLocaleString("en-NG")}.` };
  }
  if (amountNgn > cfg.maxWithdrawalNgn) {
    return { ok: false, error: `Maximum per withdrawal is ₦${cfg.maxWithdrawalNgn.toLocaleString("en-NG")}.` };
  }
  const feeNgn = roundNgn(cfg.withdrawalFeeNgn);
  const totalNgn = addNgn(amountNgn, feeNgn);
  if (totalNgn > roundNgn(balance)) {
    return {
      ok: false,
      error:
        feeNgn > 0
          ? `Insufficient balance. ₦${amountNgn.toLocaleString("en-NG")} + ₦${feeNgn.toLocaleString("en-NG")} fee is more than your wallet holds.`
          : "Insufficient balance.",
    };
  }
  return { ok: true, amountNgn, feeNgn, totalNgn };
}

/** Largest amount the customer can withdraw in one go (balance minus fee, capped). */
export function maxWithdrawable(balance: number, cfg: WalletConfig) {
  return Math.max(0, Math.min(cfg.maxWithdrawalNgn, subNgn(balance, cfg.withdrawalFeeNgn)));
}

/** Rejects non-4-digit PINs and the guessable ones (0000, 1111, 1234, 4321...). */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return "PIN must be exactly 4 digits.";
  if (/^(\d)\1{3}$/.test(pin)) return "Avoid repeated digits like 1111.";
  const d = pin.split("").map(Number);
  const step = d[1] - d[0];
  if (Math.abs(step) === 1 && d.every((v, i) => i === 0 || v - d[i - 1] === step)) {
    return "Avoid sequences like 1234 or 4321.";
  }
  return null;
}

/** Referral bonus is earned once the referred customer has sold enough. */
export function referralEarned(completedSellNgn: number, cfg: WalletConfig) {
  return cfg.referralBonusNgn > 0 && completedSellNgn >= cfg.referralMinTradeNgn;
}

// Receive-address checks moved to src/lib/asset-rules.ts (addressProblem): the format now
// comes from the network in the registry, not from a list of assets here.
