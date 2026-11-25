import { sumNgn } from "@/lib/money";

/**
 * Chart of accounts and posting rules for the double-entry ledger. Pure, unit tested.
 *
 * Every wallet movement is one balanced transaction: the customer's account on one side
 * and a system account on the other. The mapping below follows section 9 of the
 * specification and must be confirmed by finance against the real settlement set-up.
 *
 *   event                 debit                       credit
 *   NGN deposit           provider clearing           customer
 *   crypto purchase       customer                    trading settlement
 *   purchase refund       trading settlement          customer
 *   sale proceeds         trading settlement          customer
 *   withdrawal request    customer                    payout clearing
 *   withdrawal refund     payout clearing             customer
 *   withdrawal paid       payout clearing             provider clearing / bank (+ fee revenue)
 *   referral bonus        referral expense            customer
 */

export const SYSTEM_ACCOUNTS = {
  providerClearing: "asset:provider_clearing:NGN",
  bank: "asset:bank:NGN",
  payoutClearing: "liability:payout_clearing:NGN",
  tradingSettlement: "liability:trading_settlement:NGN",
  feeRevenue: "revenue:fees:NGN",
  referralExpense: "expense:referral_bonus:NGN",
  adjustments: "equity:adjustments:NGN",
} as const;

export const customerAccountCode = (userId: string) => `customer:${userId}:NGN`;
export const isCustomerAccount = (code: string) => code.startsWith("customer:");

/** Why money is entering a customer's wallet. */
export type CreditKind =
  | "deposit"
  | "sale_proceeds"
  | "purchase_refund"
  | "withdrawal_refund"
  | "referral_bonus"
  | "adjustment";
/** Why money is leaving a customer's wallet. */
export type DebitKind = "purchase" | "withdrawal" | "adjustment";

/** The system account on the other side of each kind of wallet movement. */
export const COUNTER_ACCOUNT: Record<CreditKind | DebitKind, string> = {
  deposit: SYSTEM_ACCOUNTS.providerClearing,
  sale_proceeds: SYSTEM_ACCOUNTS.tradingSettlement,
  purchase: SYSTEM_ACCOUNTS.tradingSettlement,
  purchase_refund: SYSTEM_ACCOUNTS.tradingSettlement,
  withdrawal: SYSTEM_ACCOUNTS.payoutClearing,
  withdrawal_refund: SYSTEM_ACCOUNTS.payoutClearing,
  referral_bonus: SYSTEM_ACCOUNTS.referralExpense,
  adjustment: SYSTEM_ACCOUNTS.adjustments,
};

export type LedgerLine = { account: string; direction: "DEBIT" | "CREDIT"; amount: number };

/** What is wrong with a set of lines, or null when they form a valid balanced transaction. */
export function linesProblem(lines: LedgerLine[]): string | null {
  if (lines.length < 2) return "a transaction needs at least two entries";
  if (lines.some((l) => !Number.isFinite(l.amount) || l.amount <= 0)) return "every entry needs a positive amount";
  if (lines.some((l) => sumNgn([l.amount]) !== l.amount)) return "amounts must be whole kobo";
  const debits = sumNgn(lines.filter((l) => l.direction === "DEBIT").map((l) => l.amount));
  const credits = sumNgn(lines.filter((l) => l.direction === "CREDIT").map((l) => l.amount));
  if (debits !== credits) return `debits ${debits} do not equal credits ${credits}`;
  return null;
}

/**
 * One fixed order for touching accounts (customer accounts first, then by code), so two
 * postings can never wait on each other's row locks in opposite orders.
 */
export function inLockOrder(lines: LedgerLine[]): LedgerLine[] {
  return [...lines].sort((a, b) => {
    const ac = isCustomerAccount(a.account) ? 0 : 1;
    const bc = isCustomerAccount(b.account) ? 0 : 1;
    return ac - bc || a.account.localeCompare(b.account);
  });
}

/**
 * The posting for an order that has just been completed without passing through a wallet,
 * or null when a wallet movement already recorded it.
 *
 *   sale paid to a bank account      trading settlement -> provider clearing (Paystack) or bank
 *   purchase paid by bank transfer   bank -> trading settlement
 *
 * Posted once, when the order reaches Completed: that is the first moment the money is
 * known to have moved. A payout still in flight is not in the ledger yet.
 */
export function orderSettlementPosting(order: {
  side: "SELL" | "BUY";
  payoutMethod: "BANK" | "WALLET";
  paymentRef?: string | null;
  payoutRef?: string | null;
  amountNgn: number;
}): { kind: "sale_payout" | "purchase_receipt"; lines: LedgerLine[] } | null {
  if (!(order.amountNgn > 0)) return null;
  if (order.side === "SELL") {
    if (order.payoutMethod === "WALLET") return null; // already posted as sale_proceeds
    const paidFrom = order.payoutRef?.startsWith("TRF_") ? SYSTEM_ACCOUNTS.providerClearing : SYSTEM_ACCOUNTS.bank;
    return {
      kind: "sale_payout",
      lines: [
        { account: SYSTEM_ACCOUNTS.tradingSettlement, direction: "DEBIT", amount: order.amountNgn },
        { account: paidFrom, direction: "CREDIT", amount: order.amountNgn },
      ],
    };
  }
  if (order.paymentRef?.trim().toLowerCase().startsWith("wallet:")) return null; // already posted as purchase
  return {
    kind: "purchase_receipt",
    lines: [
      { account: SYSTEM_ACCOUNTS.bank, direction: "DEBIT", amount: order.amountNgn },
      { account: SYSTEM_ACCOUNTS.tradingSettlement, direction: "CREDIT", amount: order.amountNgn },
    ],
  };
}

/** Lines for a withdrawal that has been paid: clear the payout, book the fee as revenue. */
export function withdrawalPaidLines(input: { amountNgn: number; feeNgn: number; via: "provider" | "bank" }): LedgerLine[] {
  const lines: LedgerLine[] = [
    { account: SYSTEM_ACCOUNTS.payoutClearing, direction: "DEBIT", amount: sumNgn([input.amountNgn, input.feeNgn]) },
    {
      account: input.via === "provider" ? SYSTEM_ACCOUNTS.providerClearing : SYSTEM_ACCOUNTS.bank,
      direction: "CREDIT",
      amount: input.amountNgn,
    },
  ];
  if (input.feeNgn > 0) lines.push({ account: SYSTEM_ACCOUNTS.feeRevenue, direction: "CREDIT", amount: input.feeNgn });
  return lines;
}
