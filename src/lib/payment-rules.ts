import { roundNgn, subNgn } from "@/lib/money";

/** Pure rules for gateway payments (wallet top-ups and card-paid buys). No I/O, unit tested. */

export type PaymentConfig = {
  minFundingNgn: number;
  maxFundingNgn: number;
  /** PENDING payments older than this are closed as ABANDONED by the reconcile job. */
  abandonAfterHours: number;
};

function num(v: string | undefined, fallback: number, min = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export function paymentConfig(env: Record<string, string | undefined> = process.env): PaymentConfig {
  return {
    minFundingNgn: num(env.FUNDING_MIN_NGN, 100, 1),
    maxFundingNgn: num(env.FUNDING_MAX_NGN, 5_000_000, 1),
    abandonAfterHours: num(env.PAYMENT_ABANDON_HOURS, 48, 1),
  };
}

export function fundingProblem(amount: number, cfg: PaymentConfig): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount to add.";
  const ngn = roundNgn(amount);
  if (ngn < cfg.minFundingNgn) return `Minimum top-up is ₦${cfg.minFundingNgn.toLocaleString("en-NG")}.`;
  if (ngn > cfg.maxFundingNgn) return `Maximum per top-up is ₦${cfg.maxFundingNgn.toLocaleString("en-NG")}.`;
  return null;
}

export type GatewayState = "success" | "pending" | "failed" | "abandoned";

/** Paystack transaction statuses -> our four states. Unknown values stay pending (safe default). */
export function mapGatewayStatus(status: string | undefined | null): GatewayState {
  switch ((status ?? "").toLowerCase()) {
    case "success":
      return "success";
    case "failed":
    case "reversed":
      return "failed";
    case "abandoned":
      return "abandoned";
    default:
      return "pending";
  }
}

export type SettlementPlan =
  | { ok: true; creditNgn: number; fundsOrder: boolean; note: string | null }
  | { ok: false; reason: string };

/**
 * What a verified successful payment should do. The provider's verified amount is the truth:
 * we always credit what was actually paid, and only fund a buy order if it covers the order.
 */
export function settlementPlan(input: {
  purpose: "WALLET_FUNDING" | "CRYPTO_BUY";
  expectedNgn: number;
  paidNgn: number;
  currency: string;
}): SettlementPlan {
  if (input.currency.toUpperCase() !== "NGN") return { ok: false, reason: `Paid in ${input.currency}, expected NGN.` };
  const paid = roundNgn(input.paidNgn);
  if (!(paid > 0)) return { ok: false, reason: "Provider reported no amount paid." };
  const covers = paid >= subNgn(input.expectedNgn, 0.01);
  const fundsOrder = input.purpose === "CRYPTO_BUY" && covers;
  let note: string | null = null;
  if (input.purpose === "CRYPTO_BUY" && !covers) {
    note = `Paid ₦${paid.toLocaleString("en-NG")} of ₦${roundNgn(input.expectedNgn).toLocaleString("en-NG")}; kept in wallet, order not funded.`;
  }
  return { ok: true, creditNgn: paid, fundsOrder, note };
}
