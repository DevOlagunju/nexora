import "server-only";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma, type Db } from "@/lib/db";
import { orderReference } from "@/lib/crypto";
import { rateLimit, writeAudit } from "@/lib/security";
import { addNgn, numberFrom, roundNgn, sumNgn } from "@/lib/money";
import { notifyAdmin } from "@/lib/notify";
import { paystackConfigured, payoutToBank, referenceFromTransfer, verifyTransfer } from "@/lib/paystack";
import { isPayoutLock, newPayoutLock, payoutVerdict } from "@/lib/payout-rules";
import { errorMessage, log } from "@/lib/log";
import { formatNgn } from "@/lib/format";
import {
  dailyWithdrawalProblem,
  maxWithdrawable,
  pinProblem,
  quoteWithdrawal,
  referralEarned,
  walletConfig,
  type WithdrawalsToday,
} from "@/lib/wallet-rules";
import { startOfLagosDay } from "@/lib/trade-limits";
import { pushNotification } from "@/lib/services/notifications";
import { fail, ok, TOO_MANY, type ServiceResult } from "@/lib/services/result";
import { ensureCustomerAccount, lockAndCheckFunds, postLedger } from "@/lib/services/ledger";
import {
  COUNTER_ACCOUNT,
  customerAccountCode,
  withdrawalPaidLines,
  type CreditKind,
  type DebitKind,
} from "@/lib/ledger/accounts";

/**
 * Naira wallet. Every movement is posted to the double-entry ledger (src/lib/services/ledger.ts)
 * as a balanced transaction, together with a WalletEntry line for the customer's statement,
 * in one database transaction. The balance is derived from the ledger by the database;
 * this code never writes a balance. A `reference` is unique, so a movement can never be
 * applied twice.
 */

type Actor = { id: string; email: string };
type Ctx = { ip: string };

const PIN_COST = 10;

// ---------------------------------------------------------------- ledger primitives

type Movement<K> = {
  userId: string;
  amountNgn: number;
  reference: string;
  description: string;
  /** Why the money moves: decides the account on the other side of the ledger transaction. */
  kind: K;
  /** Who or what caused it, e.g. "customer:<id>", "admin:<id>", "provider:paystack". */
  source?: string;
  /** Reference of the movement this one undoes (a refund), so the ledger links the two. */
  reverses?: string;
};

/** Credit once per reference. Returns false if that reference was already applied. */
export async function creditWallet(tx: Db, input: Movement<CreditKind>): Promise<boolean> {
  const amountNgn = roundNgn(input.amountNgn);
  if (amountNgn <= 0) return false;
  if (await tx.walletEntry.findUnique({ where: { reference: input.reference }, select: { id: true } })) return false;
  await ensureCustomerAccount(tx, input.userId);
  await postLedger(tx, {
    reference: input.reference,
    kind: input.kind,
    description: input.description,
    source: input.source,
    reverses: input.reverses,
    lines: [
      { account: COUNTER_ACCOUNT[input.kind], direction: "DEBIT", amount: amountNgn },
      { account: customerAccountCode(input.userId), direction: "CREDIT", amount: amountNgn },
    ],
  });
  await tx.walletEntry.create({
    data: { userId: input.userId, reference: input.reference, description: input.description, amountNgn, direction: "CREDIT" },
  });
  return true;
}

/**
 * Debit only if the balance covers it. Returns false otherwise, having changed nothing.
 * The customer's ledger account is locked first, so two spends can never both pass the check.
 */
export async function debitWallet(tx: Db, input: Movement<DebitKind>): Promise<boolean> {
  const amountNgn = roundNgn(input.amountNgn);
  if (amountNgn <= 0) return false;
  const accountId = await ensureCustomerAccount(tx, input.userId);
  if (!(await lockAndCheckFunds(tx, accountId, amountNgn))) return false;
  await postLedger(tx, {
    reference: input.reference,
    kind: input.kind,
    description: input.description,
    source: input.source,
    lines: [
      { account: customerAccountCode(input.userId), direction: "DEBIT", amount: amountNgn },
      { account: COUNTER_ACCOUNT[input.kind], direction: "CREDIT", amount: amountNgn },
    ],
  });
  await tx.walletEntry.create({
    data: { userId: input.userId, reference: input.reference, description: input.description, amountNgn, direction: "DEBIT" },
  });
  return true;
}

/** Ledger leg for a withdrawal that has been paid out: clears the payout and books the fee. */
async function postWithdrawalPaid(
  tx: Db,
  w: { reference: string; amountNgn: number; feeNgn: number },
  via: "provider" | "bank",
  source: string,
) {
  await postLedger(tx, {
    reference: `wd-paid:${w.reference}`,
    kind: "withdrawal_paid",
    description: `Withdrawal ${w.reference} paid (${via === "provider" ? "payment provider" : "bank transfer"})`,
    source,
    lines: withdrawalPaidLines({ amountNgn: w.amountNgn, feeNgn: w.feeNgn, via }),
  });
}

// ---------------------------------------------------------------- daily withdrawal limit

/**
 * Withdrawals requested since midnight in Lagos that count towards the daily limit. Failed and
 * cancelled ones are left out because their money went back to the wallet.
 */
async function withdrawalsToday(db: Db, userId: string): Promise<WithdrawalsToday> {
  const agg = await db.withdrawal.aggregate({
    where: { userId, createdAt: { gte: startOfLagosDay() }, status: { notIn: ["FAILED", "CANCELLED"] } },
    _sum: { amountNgn: true },
    _count: true,
  });
  return { usedNgn: roundNgn(numberFrom(agg._sum.amountNgn ?? 0)), count: agg._count };
}

// ---------------------------------------------------------------- read model

export async function getWalletOverview(userId: string) {
  const cfg = walletConfig();
  const [user, entries, withdrawals, kyc, today] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalanceNgn: true, transactionPinHash: true, pinLockedUntil: true },
    }),
    prisma.walletEntry.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.kycProfile.findUnique({ where: { userId } }),
    withdrawalsToday(prisma, userId),
  ]);
  const balance = roundNgn(Math.max(0, user?.walletBalanceNgn ?? 0));
  return {
    balance,
    maxWithdrawable: maxWithdrawable(balance, cfg, today),
    dailyWithdrawals: {
      usedNgn: today.usedNgn,
      limitNgn: cfg.dailyWithdrawalLimitNgn,
      count: today.count,
      countLimit: cfg.dailyWithdrawalCount,
    },
    hasPin: !!user?.transactionPinHash,
    pinLocked: !!user?.pinLockedUntil && user.pinLockedUntil > new Date(),
    pendingWithdrawalNgn: roundNgn(
      sumNgn(withdrawals.filter((w) => w.status === "PENDING" || w.status === "PROCESSING").map((w) => w.amountNgn)),
    ),
    entries: entries.map((e) => ({
      id: e.id,
      direction: e.direction,
      amountNgn: e.amountNgn,
      description: e.description,
      createdAt: e.createdAt,
    })),
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      reference: w.reference,
      amountNgn: w.amountNgn,
      feeNgn: w.feeNgn,
      status: w.status,
      bankName: w.bankName,
      accountLast4: w.accountNumber.slice(-4),
      adminNote: w.adminNote,
      createdAt: w.createdAt,
    })),
    bank:
      kyc?.status === "APPROVED" && kyc.bankName && kyc.accountNumber && kyc.accountName
        ? { bankName: kyc.bankName, accountName: kyc.accountName, accountLast4: kyc.accountNumber.slice(-4) }
        : null,
    config: {
      minWithdrawalNgn: cfg.minWithdrawalNgn,
      maxWithdrawalNgn: cfg.maxWithdrawalNgn,
      withdrawalFeeNgn: cfg.withdrawalFeeNgn,
    },
  };
}

export type WalletOverview = Awaited<ReturnType<typeof getWalletOverview>>;

// ---------------------------------------------------------------- transaction PIN

export async function setTransactionPin(
  user: Actor,
  input: { password?: unknown; pin?: unknown; confirmPin?: unknown },
  ctx: Ctx,
): Promise<ServiceResult<null>> {
  if (!(await rateLimit(`pin:set:${user.id}`, 5, 15 * 60_000))) return TOO_MANY();
  const pin = String(input.pin ?? "").trim();
  const problem = pinProblem(pin);
  if (problem) return fail(problem);
  if (pin !== String(input.confirmPin ?? "").trim()) return fail("PINs do not match.");

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, transactionPinHash: true } });
  if (!row) return fail("Account not found.", 404);
  if (!(await bcrypt.compare(String(input.password ?? ""), row.passwordHash))) {
    return fail("Account password is incorrect.", 401);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { transactionPinHash: await bcrypt.hash(pin, PIN_COST), pinFailedCount: 0, pinLockedUntil: null },
  });
  const changed = !!row.transactionPinHash;
  await writeAudit(changed ? "user.pin_change" : "user.pin_set", { userId: user.id, ip: ctx.ip });
  void pushNotification(user.id, {
    title: changed ? "Transaction PIN changed" : "Transaction PIN set",
    body: "If this wasn't you, contact support immediately and change your password.",
    href: "/dashboard/settings",
  });
  return ok(null, changed ? "Transaction PIN changed." : "Transaction PIN set. You can now withdraw.");
}

/** Checks the PIN with a lockout after repeated failures. */
async function checkPin(userId: string, pin: string): Promise<ServiceResult<null>> {
  const cfg = walletConfig();
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { transactionPinHash: true, pinFailedCount: true, pinLockedUntil: true },
  });
  if (!row?.transactionPinHash) return fail("Set a transaction PIN in Security before withdrawing.", 403);
  if (row.pinLockedUntil && row.pinLockedUntil > new Date()) {
    const mins = Math.ceil((row.pinLockedUntil.getTime() - Date.now()) / 60_000);
    return fail(`Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, 423);
  }
  if (await bcrypt.compare(pin, row.transactionPinHash)) {
    if (row.pinFailedCount > 0) {
      await prisma.user.update({ where: { id: userId }, data: { pinFailedCount: 0, pinLockedUntil: null } });
    }
    return ok(null);
  }
  const failed = row.pinFailedCount + 1;
  const lock = failed >= cfg.pinMaxAttempts;
  await prisma.user.update({
    where: { id: userId },
    data: lock
      ? { pinFailedCount: 0, pinLockedUntil: new Date(Date.now() + cfg.pinLockMinutes * 60_000) }
      : { pinFailedCount: failed },
  });
  if (lock) {
    await writeAudit("user.pin_locked", { userId });
    void pushNotification(userId, {
      title: "Withdrawals locked",
      body: `Too many wrong transaction PINs. Withdrawals are paused for ${cfg.pinLockMinutes} minutes.`,
      href: "/dashboard/wallet",
    });
    return fail(`Wrong PIN. Withdrawals are locked for ${cfg.pinLockMinutes} minutes.`, 423);
  }
  const left = cfg.pinMaxAttempts - failed;
  return fail(`Wrong PIN. ${left} attempt${left === 1 ? "" : "s"} left.`, 401);
}

// ---------------------------------------------------------------- withdrawals (customer)

export async function requestWithdrawal(
  user: Actor,
  input: { amountNgn?: unknown; pin?: unknown },
  ctx: Ctx,
): Promise<ServiceResult<{ reference: string }>> {
  if (!(await rateLimit(`withdraw:${user.id}`, 6, 60_000))) return TOO_MANY("withdrawal attempts");
  const cfg = walletConfig();

  const kyc = await prisma.kycProfile.findUnique({ where: { userId: user.id } });
  if (!kyc || kyc.status !== "APPROVED" || !kyc.bankName || !kyc.accountNumber || !kyc.accountName) {
    return fail("Verify your identity and bank account before withdrawing.", 403);
  }

  const pinCheck = await checkPin(user.id, String(input.pin ?? "").trim());
  if (!pinCheck.ok) return pinCheck;

  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { walletBalanceNgn: true } });
  const quote = quoteWithdrawal(Number(input.amountNgn), me?.walletBalanceNgn ?? 0, cfg);
  if (!quote.ok) return fail(quote.error, 422);

  const reference = orderReference("NXW");
  const created = await prisma.$transaction(async (tx) => {
    // Lock the customer's ledger account first: simultaneous requests then queue here, so each
    // one sees the withdrawals before it and two cannot both squeeze under the daily limit.
    const accountId = await ensureCustomerAccount(tx, user.id);
    if (!(await lockAndCheckFunds(tx, accountId, quote.totalNgn))) return { error: "Insufficient balance." };
    const overLimit = dailyWithdrawalProblem(quote.amountNgn, await withdrawalsToday(tx, user.id), cfg);
    if (overLimit) return { error: overLimit };

    const debited = await debitWallet(tx, {
      userId: user.id,
      amountNgn: quote.totalNgn,
      reference: `wd:${reference}`,
      kind: "withdrawal",
      source: `customer:${user.id}`,
      description:
        quote.feeNgn > 0
          ? `Withdrawal ${reference} (${formatNgn(quote.amountNgn)} + ${formatNgn(quote.feeNgn)} fee)`
          : `Withdrawal ${reference}`,
    });
    if (!debited) return { error: "Insufficient balance." };
    await tx.withdrawal.create({
      data: {
        reference,
        userId: user.id,
        amountNgn: quote.amountNgn,
        feeNgn: quote.feeNgn,
        bankName: kyc.bankName!,
        accountNumber: kyc.accountNumber!,
        accountName: kyc.accountName!,
        bankCode: kyc.bankCode,
      },
    });
    return { error: null };
  });
  if (created.error) return fail(created.error, 422);

  await writeAudit("wallet.withdraw_request", {
    userId: user.id,
    ip: ctx.ip,
    meta: { reference, amountNgn: quote.amountNgn, feeNgn: quote.feeNgn },
  });
  void notifyAdmin("wallet.withdrawal_requested", { reference, amountNgn: quote.amountNgn, userId: user.id });
  void pushNotification(user.id, {
    title: `Withdrawal ${formatNgn(quote.amountNgn)} requested`,
    body: `Going to ${kyc.bankName} â€¢â€¢${kyc.accountNumber.slice(-4)}. Ref ${reference}.`,
    href: "/dashboard/wallet",
  });
  return ok({ reference }, `Withdrawal of ${formatNgn(quote.amountNgn)} requested. Ref ${reference}.`);
}

/** Refund a withdrawal back to the wallet (idempotent via the ledger reference). */
async function refundWithdrawal(tx: Db, w: { userId: string; reference: string; amountNgn: number; feeNgn: number }, why: string) {
  return creditWallet(tx, {
    userId: w.userId,
    amountNgn: addNgn(w.amountNgn, w.feeNgn),
    reference: `wd-refund:${w.reference}`,
    kind: "withdrawal_refund",
    reverses: `wd:${w.reference}`,
    description: `Refund: withdrawal ${w.reference} ${why}`,
  });
}

export async function cancelWithdrawal(user: Actor, input: { id?: unknown }): Promise<ServiceResult<null>> {
  const id = String(input.id ?? "");
  const w = await prisma.withdrawal.findFirst({ where: { id, userId: user.id } });
  if (!w) return fail("Withdrawal not found.", 404);
  if (w.status !== "PENDING") return fail("Only withdrawals that haven't started processing can be cancelled.", 409);

  const done = await prisma.$transaction(async (tx) => {
    const { count } = await tx.withdrawal.updateMany({
      where: { id: w.id, status: "PENDING" },
      data: { status: "CANCELLED", adminNote: "Cancelled by customer", processedAt: new Date() },
    });
    if (count === 0) return false;
    await refundWithdrawal(tx, w, "cancelled");
    return true;
  });
  if (!done) return fail("The desk already picked this up. Refresh to see its status.", 409);
  await writeAudit("wallet.withdraw_cancel", { userId: user.id, meta: { reference: w.reference } });
  return ok(null, `Withdrawal ${w.reference} cancelled and refunded to your wallet.`);
}

// ---------------------------------------------------------------- withdrawals (desk)

export type WithdrawalDeskAction = "paystack" | "verify" | "mark-paid" | "reject";

const UNCONFIRMED_NOTE = "Paystack has not confirmed this transfer. Verify before paying by hand.";

export async function processWithdrawal(
  admin: { id: string },
  input: { id?: unknown; action?: unknown; payoutRef?: unknown; note?: unknown },
): Promise<ServiceResult<null>> {
  const id = String(input.id ?? "");
  const action = String(input.action ?? "") as WithdrawalDeskAction;
  const note = String(input.note ?? "").trim().slice(0, 300) || null;
  const w = await prisma.withdrawal.findUnique({ where: { id } });
  if (!w) return fail("Withdrawal not found.", 404);

  if (action === "paystack") {
    if (!paystackConfigured()) return fail("Paystack is not configured. Pay manually and use Mark paid.");
    if (w.status !== "PENDING") return fail(`${w.reference} is ${w.status.toLowerCase()}, not pending.`, 409);
    const lock = newPayoutLock(admin.id);
    const claimed = await prisma.withdrawal.updateMany({
      where: { id, status: "PENDING", payoutRef: null },
      data: { status: "PROCESSING", payoutRef: lock },
    });
    if (claimed.count === 0) return fail("Another admin is already paying this withdrawal.", 409);
    const res = await payoutToBank({
      amountNgn: w.amountNgn,
      accountName: w.accountName,
      accountNumber: w.accountNumber,
      bankName: w.bankName,
      bankCode: w.bankCode,
      reference: w.reference,
      reason: `Nexora withdrawal ${w.reference}`,
    }).catch((err) => ({ ok: false as const, unknown: true, message: errorMessage(err) }));
    if (!res.ok && res.unknown) {
      // The transfer may exist. Keep it PROCESSING and locked: the customer cannot cancel it,
      // and nobody can send it again, until Paystack gives a definite answer.
      await prisma.withdrawal.updateMany({ where: { id, payoutRef: lock }, data: { adminNote: UNCONFIRMED_NOTE } });
      log.error("withdrawal: paystack outcome unknown", { reference: w.reference, error: res.message });
      await writeAudit("admin.withdrawal_paystack_unconfirmed", {
        userId: admin.id,
        meta: { reference: w.reference, error: res.message },
      });
      void notifyAdmin("wallet.withdrawal_unconfirmed", { reference: w.reference, amountNgn: w.amountNgn, error: res.message });
      return fail(
        `Paystack did not confirm the transfer for ${w.reference} (${res.message}). It is held as Processing. Do not pay it by hand: use Verify with Paystack in a few minutes.`,
        502,
      );
    }
    if (!res.ok) {
      await prisma.withdrawal.updateMany({ where: { id, payoutRef: lock }, data: { status: "PENDING", payoutRef: null } });
      return fail(res.message);
    }
    // Only replace our own lock: the webhook may already have settled this transfer.
    await prisma.withdrawal.updateMany({ where: { id, payoutRef: lock }, data: { payoutRef: res.payoutRef, adminNote: note } });
    await writeAudit("admin.withdrawal_paystack", { userId: admin.id, meta: { reference: w.reference, payoutRef: res.payoutRef } });
    return ok(null, `Paystack transfer ${res.payoutRef} started for ${w.reference}.`);
  }

  if (action === "verify") {
    if (!paystackConfigured()) return fail("Paystack is not configured.");
    if (w.status !== "PROCESSING") return fail(`${w.reference} is ${w.status.toLowerCase()}, nothing to verify.`, 409);
    const outcome = await resolveWithdrawalPayout(w);
    await writeAudit("admin.withdrawal_verify", { userId: admin.id, meta: { reference: w.reference, outcome } });
    const message: Record<typeof outcome, string> = {
      paid: `Paystack confirms ${w.reference} was paid.`,
      in_flight: `Paystack is still sending ${w.reference}. Nothing to do yet.`,
      failed: `Paystack says the transfer for ${w.reference} failed. The amount is back in the customer's wallet.`,
      never_sent: `Paystack has no transfer for ${w.reference}. It is Pending again and safe to pay.`,
      wait: `Paystack has no answer for ${w.reference} yet. It stays Processing; try again in a few minutes.`,
      error: `Could not reach Paystack to verify ${w.reference}. Try again shortly.`,
    };
    return outcome === "error" ? fail(message[outcome], 502) : ok(null, message[outcome]);
  }

  if (action === "mark-paid") {
    const payoutRef = String(input.payoutRef ?? "").trim().slice(0, 120);
    if (!payoutRef) return fail("Enter the bank transfer reference.");
    // Status change and ledger posting commit together, or not at all.
    const count = await prisma.$transaction(async (tx) => {
      const moved = await tx.withdrawal.updateMany({
        where: { id, status: { in: ["PENDING", "PROCESSING"] } },
        data: { status: "PAID", payoutRef, adminNote: note, processedAt: new Date() },
      });
      if (moved.count > 0) await postWithdrawalPaid(tx, w, "bank", `admin:${admin.id}`);
      return moved.count;
    });
    if (count === 0) return fail(`${w.reference} is already ${w.status.toLowerCase()}.`, 409);
    await writeAudit("admin.withdrawal_paid", { userId: admin.id, meta: { reference: w.reference, payoutRef } });
    void pushNotification(w.userId, {
      title: `${formatNgn(w.amountNgn)} sent to your bank`,
      body: `Withdrawal ${w.reference} was paid to ${w.bankName} â€¢â€¢${w.accountNumber.slice(-4)}.`,
      href: "/dashboard/wallet",
    });
    return ok(null, `${w.reference} marked paid.`);
  }

  if (action === "reject") {
    if (w.status !== "PENDING") return fail("Only pending withdrawals can be rejected.", 409);
    const done = await prisma.$transaction(async (tx) => {
      const { count } = await tx.withdrawal.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "FAILED", adminNote: note ?? "Rejected by desk", processedAt: new Date() },
      });
      if (count === 0) return false;
      await refundWithdrawal(tx, w, "rejected");
      return true;
    });
    if (!done) return fail("Withdrawal changed while you were editing. Reload.", 409);
    await writeAudit("admin.withdrawal_reject", { userId: admin.id, meta: { reference: w.reference, note } });
    void pushNotification(w.userId, {
      title: "Withdrawal returned to your wallet",
      body: `${w.reference} could not be paid${note ? `: ${note}` : "."} The full amount is back in your wallet.`,
      href: "/dashboard/wallet",
    });
    return ok(null, `${w.reference} rejected and refunded.`);
  }

  return fail("Unknown action.");
}

type WithdrawalRow = {
  id: string;
  userId: string;
  reference: string;
  amountNgn: number;
  feeNgn: number;
  bankName: string;
  accountNumber: string;
  status: string;
  payoutRef: string | null;
};

/** Apply a definite transfer result to a withdrawal. Idempotent: a settled row never moves again. */
async function applyWithdrawalOutcome(
  w: WithdrawalRow,
  success: boolean,
  transferCode: string | null,
  reason?: string | null,
): Promise<boolean> {
  if (success) {
    // PENDING is included on purpose: if the money really left, the customer must not be able to cancel and be refunded.
    const count = await prisma.$transaction(async (tx) => {
      const moved = await tx.withdrawal.updateMany({
        where: { id: w.id, status: { in: ["PROCESSING", "PENDING"] } },
        data: { status: "PAID", processedAt: new Date(), ...(transferCode ? { payoutRef: transferCode } : {}) },
      });
      if (moved.count > 0) await postWithdrawalPaid(tx, w, "provider", "provider:paystack");
      return moved.count;
    });
    if (count > 0) {
      void pushNotification(w.userId, {
        title: `${formatNgn(w.amountNgn)} sent to your bank`,
        body: `Withdrawal ${w.reference} was paid to ${w.bankName} â€¢â€¢${w.accountNumber.slice(-4)}.`,
        href: "/dashboard/wallet",
      });
    } else if (w.status === "FAILED" || w.status === "CANCELLED") {
      // Money left the bank for a withdrawal we no longer hold as in flight. A person must look at this.
      log.error("withdrawal: transfer succeeded but withdrawal is not processing", { reference: w.reference, status: w.status });
      void notifyAdmin("wallet.withdrawal_paid_unexpected", { reference: w.reference, status: w.status, transferCode });
    }
    return count > 0;
  }
  const applied = await prisma.$transaction(async (tx) => {
    const { count } = await tx.withdrawal.updateMany({
      where: { id: w.id, status: "PROCESSING" },
      data: { status: "FAILED", adminNote: `Bank transfer failed: ${reason ?? "no reason given"}`, processedAt: new Date() },
    });
    if (count === 0) return false;
    await refundWithdrawal(tx, w, "failed at the bank");
    return true;
  });
  if (applied) {
    void notifyAdmin("wallet.withdrawal_failed", { reference: w.reference, transferCode, reason });
    void pushNotification(w.userId, {
      title: "Withdrawal returned to your wallet",
      body: `The bank transfer for ${w.reference} failed, so the full amount is back in your wallet. You can try again.`,
      href: "/dashboard/wallet",
    });
  }
  return applied;
}

/**
 * Paystack webhook leg for withdrawals. Matches on the transfer code, or on our own transfer
 * reference when the code was never recorded (response lost, or the webhook beat our write).
 * Returns null when the transfer isn't a withdrawal.
 */
export async function settleWithdrawalTransfer(
  transferCode: string,
  success: boolean,
  reason?: string,
  transferRef?: string | null,
) {
  const ownRef = referenceFromTransfer(transferRef);
  const w =
    (await prisma.withdrawal.findFirst({ where: { payoutRef: transferCode } })) ??
    (ownRef ? await prisma.withdrawal.findUnique({ where: { reference: ownRef } }) : null);
  if (!w) return null;
  return { reference: w.reference, applied: await applyWithdrawalOutcome(w, success, transferCode, reason) };
}

export type PayoutResolution = "paid" | "in_flight" | "failed" | "never_sent" | "wait" | "error";

/**
 * Ask Paystack what happened to a PROCESSING withdrawal and act only on a definite answer.
 * Used by the desk "Verify" button and the reconcile sweep.
 */
export async function resolveWithdrawalPayout(w: WithdrawalRow, now = Date.now()): Promise<PayoutResolution> {
  let transfer;
  try {
    transfer = await verifyTransfer(w.reference);
  } catch (err) {
    log.warn("withdrawal: verify failed", { reference: w.reference, error: errorMessage(err) });
    return "error";
  }
  const verdict = payoutVerdict({ state: transfer.state, payoutRef: w.payoutRef, now });
  if (verdict === "paid") await applyWithdrawalOutcome(w, true, transfer.transferCode);
  else if (verdict === "failed") await applyWithdrawalOutcome(w, false, transfer.transferCode, transfer.reason);
  else if (verdict === "in_flight" && transfer.transferCode && isPayoutLock(w.payoutRef)) {
    // Record the code we never received, so the transfer webhook can match it.
    await prisma.withdrawal.updateMany({
      where: { id: w.id, status: "PROCESSING", payoutRef: w.payoutRef },
      data: { payoutRef: transfer.transferCode, adminNote: null },
    });
  } else if (verdict === "never_sent") {
    await prisma.withdrawal.updateMany({
      where: { id: w.id, status: "PROCESSING", payoutRef: w.payoutRef },
      data: { status: "PENDING", payoutRef: null, adminNote: "Paystack never received the transfer. Safe to pay again." },
    });
  }
  return verdict;
}

/** Cron leg: withdrawals stuck in PROCESSING (lost response or missed webhook). */
export async function reconcileWithdrawalPayouts(now = new Date()) {
  if (!paystackConfigured()) return { checked: 0, resolved: 0 };
  const stuck = await prisma.withdrawal.findMany({
    where: { status: "PROCESSING", updatedAt: { lte: new Date(now.getTime() - 2 * 60_000) } },
    orderBy: { updatedAt: "asc" },
    take: 25,
  });
  let resolved = 0;
  for (const w of stuck) {
    const outcome = await resolveWithdrawalPayout(w, now.getTime());
    if (outcome === "paid" || outcome === "failed" || outcome === "never_sent") resolved++;
  }
  return { checked: stuck.length, resolved };
}

// ---------------------------------------------------------------- referrals

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newReferralCode() {
  const bytes = randomBytes(6);
  return `NX${Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")}`;
}

/** Existing accounts get a code the first time they open the referral page. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
  if (u?.referralCode) return u.referralCode;
  for (let i = 0; i < 5; i++) {
    const code = newReferralCode();
    try {
      await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
      return code;
    } catch (err) {
      if ((err as { code?: string })?.code !== "P2002") throw err;
    }
  }
  throw new Error("Could not allocate a referral code");
}

export async function getReferralOverview(userId: string) {
  const cfg = walletConfig();
  const code = await ensureReferralCode(userId);
  const [referrals, earned] = await Promise.all([
    prisma.user.findMany({
      where: { referredById: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, fullName: true, createdAt: true },
    }),
    prisma.walletEntry.findMany({
      where: { userId, reference: { startsWith: "referral:" } },
      select: { reference: true, amountNgn: true },
    }),
  ]);
  const paid = new Set(earned.map((e) => e.reference.slice("referral:".length)));
  return {
    code,
    bonusNgn: cfg.referralBonusNgn,
    minTradeNgn: cfg.referralMinTradeNgn,
    earnedNgn: sumNgn(earned.map((e) => e.amountNgn)),
    referrals: referrals.map((r) => ({
      id: r.id,
      // First name + initial only: the referrer doesn't need the full identity.
      name: (() => {
        const [first, last] = r.fullName.trim().split(/\s+/);
        return last ? `${first} ${last[0]}.` : first;
      })(),
      joinedAt: r.createdAt,
      rewarded: paid.has(r.id),
    })),
  };
}

/**
 * Pays the referrer once the referred customer's completed sells cross the threshold.
 * Safe to call after every completed order: the ledger reference makes it one-shot.
 */
export async function maybeAwardReferral(refereeId: string) {
  const cfg = walletConfig();
  if (cfg.referralBonusNgn <= 0) return;
  try {
    const referee = await prisma.user.findUnique({
      where: { id: refereeId },
      select: { referredById: true, fullName: true },
    });
    if (!referee?.referredById) return;
    if (await prisma.walletEntry.findUnique({ where: { reference: `referral:${refereeId}` }, select: { id: true } })) return;

    const [c, g] = await Promise.all([
      prisma.cryptoOrder.aggregate({ where: { userId: refereeId, side: "SELL", status: "COMPLETED" }, _sum: { amountNgn: true } }),
      prisma.giftCardOrder.aggregate({ where: { userId: refereeId, status: "COMPLETED" }, _sum: { amountNgn: true } }),
    ]);
    if (!referralEarned(addNgn(numberFrom(c._sum.amountNgn), numberFrom(g._sum.amountNgn)), cfg)) return;

    const referrerId = referee.referredById;
    const first = referee.fullName.split(/\s+/)[0];
    const credited = await prisma.$transaction((tx) =>
      creditWallet(tx, {
        userId: referrerId,
        amountNgn: cfg.referralBonusNgn,
        reference: `referral:${refereeId}`,
        kind: "referral_bonus",
        description: `Referral bonus: ${first} completed their first trades`,
      }),
    );
    if (credited) {
      await writeAudit("wallet.referral_bonus", { userId: referrerId, meta: { refereeId, amountNgn: cfg.referralBonusNgn } });
      void pushNotification(referrerId, {
        title: `You earned ${formatNgn(cfg.referralBonusNgn)}`,
        body: `${first} joined with your code and completed a trade. The bonus is in your wallet.`,
        href: "/dashboard/wallet",
      });
    }
  } catch (err) {
    log.error("referral: award failed", { refereeId, error: errorMessage(err) });
  }
}
