/**
 * Pure wallet rules (no DB). Unit tested in tests/wallet-rules.test.ts.
 * Amounts are NGN floats, rounded with roundNgn at every boundary.
 */
import { addNgn, roundNgn, subNgn } from "@/lib/money";

export type WalletConfig = {
  minWithdrawalNgn: number;
  maxWithdrawalNgn: number;
  /** Most a customer can withdraw per Lagos day (amounts asked, fees not counted). */
  dailyWithdrawalLimitNgn: number;
  /** Most withdrawals a customer can request per Lagos day. */
  dailyWithdrawalCount: number;
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
    dailyWithdrawalLimitNgn: num(env.WALLET_DAILY_WITHDRAWAL_LIMIT_NGN, 5_000_000, 1),
    dailyWithdrawalCount: Math.floor(num(env.WALLET_DAILY_WITHDRAWAL_COUNT, 5, 1)),
    // ₦100 flat, the fee Jeroid publishes for a Naira withdrawal (terms, June 2026).
    withdrawalFeeNgn: num(env.WALLET_WITHDRAWAL_FEE_NGN, 100),
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

/** Today's withdrawals that count towards the daily limit (failed and cancelled ones were refunded). */
export type WithdrawalsToday = { usedNgn: number; count: number };

/** Why a withdrawal would break the daily limits, or null if it fits. */
export function dailyWithdrawalProblem(amountNgn: number, today: WithdrawalsToday, cfg: WalletConfig): string | null {
  const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;
  if (today.count >= cfg.dailyWithdrawalCount) {
    return `You can make ${cfg.dailyWithdrawalCount} withdrawal${cfg.dailyWithdrawalCount === 1 ? "" : "s"} a day. Try again tomorrow.`;
  }
  const left = Math.max(0, subNgn(cfg.dailyWithdrawalLimitNgn, today.usedNgn));
  if (roundNgn(amountNgn) > left) {
    return left > 0
      ? `Daily withdrawal limit is ${naira(cfg.dailyWithdrawalLimitNgn)}. You can withdraw up to ${naira(left)} more today.`
      : `You have reached today's withdrawal limit of ${naira(cfg.dailyWithdrawalLimitNgn)}. Try again tomorrow.`;
  }
  return null;
}

/**
 * Largest amount the customer can withdraw in one go: balance minus fee, capped per withdrawal
 * and, when today's withdrawals are given, by what is left of the daily limit.
 */
export function maxWithdrawable(balance: number, cfg: WalletConfig, today?: WithdrawalsToday) {
  let max = Math.min(cfg.maxWithdrawalNgn, subNgn(balance, cfg.withdrawalFeeNgn));
  if (today) {
    max = today.count >= cfg.dailyWithdrawalCount ? 0 : Math.min(max, subNgn(cfg.dailyWithdrawalLimitNgn, today.usedNgn));
  }
  return Math.max(0, max);
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
