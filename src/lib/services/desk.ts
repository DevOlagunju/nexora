import "server-only";
import { prisma, type Db } from "@/lib/db";
import { postLedger } from "@/lib/services/ledger";
import { orderSettlementPosting } from "@/lib/ledger/accounts";
import { decryptSecret, maskSecret } from "@/lib/crypto";
import { writeAudit } from "@/lib/security";
import { orderStatusSchema, rateUpdateSchema } from "@/lib/validators";
import { notifyAdmin } from "@/lib/notify";
import { notifyOrderStatus } from "@/lib/notify-user";
import { paystackConfigured, payoutSellOrder, referenceFromTransfer, verifyTransfer } from "@/lib/paystack";
import { isPayoutLock, newPayoutLock, PAYOUT_LOCK_PREFIX, payoutVerdict } from "@/lib/payout-rules";
import { canTransition, allowedNextStatuses, STATUS_LABEL } from "@/lib/order-status";
import { fetchReliableDeskBenchmark, deskQuotesFromBenchmark } from "@/lib/rate-benchmark";
import { errorMessage, log } from "@/lib/log";
import type { OrderStatus } from "@/generated/prisma/enums";
import { fail, ok, type ServiceResult } from "@/lib/services/result";
import { creditWallet, maybeAwardReferral, type PayoutResolution } from "@/lib/services/wallet";
import { formatNgn } from "@/lib/format";
import { checkRateAlerts } from "@/lib/services/rate-alerts";

type Admin = { id: string };
export type OrderChannel = "crypto" | "gift";

type DeskOrder = {
  id: string;
  reference: string;
  userId: string;
  status: OrderStatus;
  payoutRef: string | null;
  amountNgn: number;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  /** Only crypto orders have a side; gift cards are always customer sells. */
  side: "SELL" | "BUY";
  payoutMethod: "BANK" | "WALLET";
  /** Crypto buys only. "wallet:<ref>" means the customer paid from their Naira wallet. */
  paymentRef?: string | null;
};

type OrderUpdate = {
  status: OrderStatus;
  adminNote?: string;
  payoutRef?: string | null;
  completedAt?: Date;
};

/** What a payout needs to know about an order, whichever table it lives in. */
type PayoutOrder = { id: string; reference: string; userId: string; status: OrderStatus; payoutRef: string | null };
type PayoutWhere = {
  id?: string;
  status?: OrderStatus;
  payoutRef?: string | null | { startsWith: string };
  updatedAt?: { lte: Date };
  OR?: PayoutWhere[];
};
type PayoutData = { status?: OrderStatus; payoutRef?: string | null; adminNote?: string | null; completedAt?: Date };
const PAYOUT_SELECT = { id: true, reference: true, userId: true, status: true, payoutRef: true } as const;

/** Narrow adapter so crypto and gift orders share one desk workflow. */
const repo: Record<
  OrderChannel,
  {
    find(id: string): Promise<DeskOrder | null>;
    claimPayout(id: string, lock: string): Promise<number>;
    releasePayout(id: string, lock: string): Promise<void>;
    update(id: string, data: OrderUpdate, expectStatus?: OrderStatus): Promise<number>;
    findPayout(where: { id: string } | { payoutRef: string } | { reference: string }): Promise<PayoutOrder | null>;
    listPayouts(where: PayoutWhere, take: number): Promise<PayoutOrder[]>;
    updatePayout(where: PayoutWhere, data: PayoutData): Promise<number>;
  }
> = {
  crypto: {
    findPayout: (where) => prisma.cryptoOrder.findFirst({ where, select: PAYOUT_SELECT }),
    listPayouts: (where, take) =>
      prisma.cryptoOrder.findMany({ where, select: PAYOUT_SELECT, orderBy: { updatedAt: "asc" }, take }),
    updatePayout: async (where, data) => (await prisma.cryptoOrder.updateMany({ where, data })).count,
    find: (id) => prisma.cryptoOrder.findUnique({ where: { id } }),
    claimPayout: async (id, lock) =>
      (
        await prisma.cryptoOrder.updateMany({
          where: { id, payoutRef: null, status: { notIn: ["PAYOUT_SENT", "COMPLETED"] } },
          data: { payoutRef: lock },
        })
      ).count,
    releasePayout: async (id, lock) => {
      await prisma.cryptoOrder.updateMany({ where: { id, payoutRef: lock }, data: { payoutRef: null } });
    },
    update: async (id, data, expectStatus) =>
      (
        await prisma.cryptoOrder.updateMany({
          where: { id, ...(expectStatus ? { status: expectStatus } : {}) },
          data,
        })
      ).count,
  },
  gift: {
    findPayout: (where) => prisma.giftCardOrder.findFirst({ where, select: PAYOUT_SELECT }),
    listPayouts: (where, take) =>
      prisma.giftCardOrder.findMany({ where, select: PAYOUT_SELECT, orderBy: { updatedAt: "asc" }, take }),
    updatePayout: async (where, data) => (await prisma.giftCardOrder.updateMany({ where, data })).count,
    find: async (id) => {
      const o = await prisma.giftCardOrder.findUnique({ where: { id } });
      return o ? { ...o, side: "SELL" as const } : null;
    },
    claimPayout: async (id, lock) =>
      (
        await prisma.giftCardOrder.updateMany({
          where: { id, payoutRef: null, status: { notIn: ["PAYOUT_SENT", "COMPLETED"] } },
          data: { payoutRef: lock },
        })
      ).count,
    releasePayout: async (id, lock) => {
      await prisma.giftCardOrder.updateMany({ where: { id, payoutRef: lock }, data: { payoutRef: null } });
    },
    update: async (id, data, expectStatus) =>
      (
        await prisma.giftCardOrder.updateMany({
          where: { id, ...(expectStatus ? { status: expectStatus } : {}) },
          data,
        })
      ).count,
  },
};

export { isPayoutLock };

/**
 * Desk status change, optionally firing a Paystack payout for sell orders.
 * Enforces the order state machine and guards against double payouts with a DB lock.
 */
export async function updateOrderStatus(
  admin: Admin,
  channel: OrderChannel,
  input: { id?: unknown; status?: unknown; adminNote?: unknown; payoutRef?: unknown; triggerPayout?: boolean },
): Promise<ServiceResult<null>> {
  const parsed = orderStatusSchema.safeParse({
    id: input.id,
    status: input.status,
    adminNote: input.adminNote || undefined,
    payoutRef: input.payoutRef || undefined,
    triggerPayout: input.triggerPayout,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const r = repo[channel];
  const order = await r.find(parsed.data.id);
  if (!order) return fail("Order not found.", 404);

  // Wallet payouts are internal: "pay out" means credit the wallet and close the order.
  const toWallet = order.side === "SELL" && order.payoutMethod === "WALLET";
  const paidFromWallet = order.side === "BUY" && !!order.paymentRef?.startsWith("wallet:");
  const wantsPayout = !!input.triggerPayout && order.side === "SELL";
  const triggerPayout = wantsPayout && !toWallet && paystackConfigured();
  let status: OrderStatus = triggerPayout ? "PAYOUT_SENT" : parsed.data.status;
  if (toWallet && (wantsPayout || status === "PAYOUT_SENT")) status = "COMPLETED";
  // While a transfer is unconfirmed the lock must survive: no status change, no typed-over payout ref.
  const locked = isPayoutLock(order.payoutRef);
  if (locked && (status !== order.status || wantsPayout)) {
    return fail(
      `A Paystack payout for ${order.reference} is not confirmed yet. Use Verify payout before changing or paying this order.`,
      409,
    );
  }
  let payoutRef = locked ? undefined : parsed.data.payoutRef;
  let payoutMessage = "";
  let payoutLock: string | null = null;

  if (!canTransition(order.status, status)) {
    const allowed = allowedNextStatuses(order.status).map((s) => STATUS_LABEL[s] ?? s).join(", ");
    return fail(
      `Cannot move ${order.reference} from ${STATUS_LABEL[order.status]} to ${STATUS_LABEL[status]}. Allowed: ${allowed}.`,
      409,
    );
  }

  if (paidFromWallet && order.status === "REJECTED" && status !== "REJECTED") {
    return fail("This order was paid from the wallet and already refunded. Ask the customer to place a new order.", 409);
  }

  if (triggerPayout) {
    if (!order.accountName || !order.accountNumber || !order.bankName) {
      return fail("Order missing bank details for Paystack payout.");
    }
    const lock = newPayoutLock(admin.id);
    if ((await r.claimPayout(order.id, lock)) === 0) {
      return fail(
        `Payout already recorded or in progress for ${order.reference}${order.payoutRef ? ` (${order.payoutRef})` : ""}. Do not re-trigger.`,
        409,
      );
    }
    const kycBank = await prisma.kycProfile.findUnique({
      where: { userId: order.userId },
      select: { bankCode: true, accountNumber: true },
    });
    const result = await payoutSellOrder({
      bankCode: kycBank?.accountNumber === order.accountNumber ? kycBank.bankCode : null,
      amountNgn: order.amountNgn,
      accountName: order.accountName,
      accountNumber: order.accountNumber,
      bankName: order.bankName,
      orderReference: order.reference,
    }).catch((err) => ({ ok: false as const, unknown: true, message: errorMessage(err) }));
    if (!result.ok && result.unknown) {
      // The transfer may exist. Keep the lock so it cannot be sent again or paid by hand
      // until Paystack gives a definite answer (Verify payout, or the reconcile sweep).
      await r.updatePayout({ id: order.id, payoutRef: lock }, { adminNote: UNCONFIRMED_PAYOUT_NOTE });
      log.error("desk: paystack payout outcome unknown", { reference: order.reference, error: result.message });
      await writeAudit("admin.payout_unconfirmed", {
        userId: admin.id,
        meta: { channel, reference: order.reference, error: result.message },
      });
      void notifyAdmin("paystack.payout_unconfirmed", { reference: order.reference, amountNgn: order.amountNgn, error: result.message });
      return fail(
        `Paystack did not confirm the payout for ${order.reference} (${result.message}). Do not pay it by hand: use Verify payout in a few minutes.`,
        502,
      );
    }
    if (!result.ok) {
      await r.releasePayout(order.id, lock);
      return fail(result.message);
    }
    payoutRef = result.payoutRef;
    payoutLock = lock;
    status = "PAYOUT_SENT";
    payoutMessage = ` Paystack transfer ${result.payoutRef} initiated.`;
  }

  const data: OrderUpdate = { status, adminNote: parsed.data.adminNote, payoutRef };
  if (status === "COMPLETED" || status === "PAYOUT_SENT") data.completedAt = new Date();

  const creditsWallet = toWallet && status === "COMPLETED" && order.status !== "COMPLETED";
  const refundsWallet =
    paidFromWallet && (status === "REJECTED" || status === "CANCELLED") && status !== order.status;

  if (creditsWallet || refundsWallet) {
    // Status change and ledger entry commit together, or not at all.
    if (creditsWallet) data.payoutRef = `wallet:${order.reference}`;
    const applied = await prisma.$transaction(async (tx) => {
      const where = { id: order.id, status: order.status };
      const { count } =
        channel === "crypto"
          ? await tx.cryptoOrder.updateMany({ where, data })
          : await tx.giftCardOrder.updateMany({ where, data });
      if (count === 0) return false;
      await creditWallet(tx, {
        userId: order.userId,
        amountNgn: order.amountNgn,
        reference: creditsWallet ? `order:${order.reference}` : `buy-refund:${order.reference}`,
        kind: creditsWallet ? "sale_proceeds" : "purchase_refund",
        reverses: creditsWallet ? undefined : `buy:${order.reference}`,
        source: `admin:${admin.id}`,
        description: creditsWallet
          ? `${channel === "gift" ? "Gift card" : "Crypto"} sale ${order.reference}`
          : `Refund: buy order ${order.reference} ${status === "REJECTED" ? "rejected" : "cancelled"}`,
      });
      return true;
    });
    if (!applied) return fail("Order changed while you were editing. Reload and try again.", 409);
    payoutRef = data.payoutRef ?? undefined;
    payoutMessage = creditsWallet
      ? ` ${formatNgn(order.amountNgn)} credited to the customer's wallet.`
      : ` ${formatNgn(order.amountNgn)} refunded to the customer's wallet.`;
  } else if (payoutLock) {
    // We hold the lock, so record the transfer whatever the status is now. If the lock is
    // already gone, the transfer webhook got here first and the order is settled: leave it.
    const recorded = await r.updatePayout({ id: order.id, payoutRef: payoutLock }, data);
    if (recorded === 0) {
      await writeAudit(channel === "crypto" ? "admin.crypto_status" : "admin.gift_status", {
        userId: admin.id,
        meta: { id: order.id, from: order.status, status, payoutRef, triggerPayout, settledByWebhook: true },
      });
      return ok(null, `${channel === "crypto" ? "Crypto" : "Gift card"} order paid.${payoutMessage}`);
    }
  } else if (status === "COMPLETED" && order.status !== "COMPLETED") {
    // Completing an order that never touched a wallet still means Naira moved (a bank payout,
    // or a bank transfer received). The ledger posting commits with the status change.
    const updated = await prisma.$transaction(async (tx) => {
      const count = await updateOrderRows(tx, channel, { id: order.id, status: order.status }, data);
      if (count > 0) await postOrderSettlement(tx, channel, order.id, `admin:${admin.id}`);
      return count;
    });
    if (updated === 0) return fail("Order changed while you were editing. Reload and try again.", 409);
  } else {
    // Refuse to overwrite a status someone else changed since the page loaded.
    const updated = await r.update(order.id, data, order.status);
    if (updated === 0) return fail("Order changed while you were editing. Reload and try again.", 409);
  }

  await writeAudit(channel === "crypto" ? "admin.crypto_status" : "admin.gift_status", {
    userId: admin.id,
    meta: { id: order.id, from: order.status, status, payoutRef, triggerPayout },
  });
  void notifyAdmin(channel === "crypto" ? "admin.crypto_updated" : "admin.gift_updated", {
    id: order.id,
    reference: order.reference,
    status,
    payoutRef,
  });
  if (status !== order.status) {
    const customer = await prisma.user.findUnique({ where: { id: order.userId }, select: { email: true } });
    void notifyOrderStatus({
      userId: order.userId,
      email: customer?.email,
      reference: order.reference,
      status,
      channel,
      note: parsed.data.adminNote,
      walletCredited: creditsWallet ? order.amountNgn : undefined,
    });
    if (status === "COMPLETED" && order.side === "SELL") void maybeAwardReferral(order.userId);
  }

  return ok(null, `${channel === "crypto" ? "Crypto" : "Gift card"} order updated.${payoutMessage}`);
}

// ---------------------------------------------------------------- ledger for orders

async function updateOrderRows(tx: Db, channel: OrderChannel, where: PayoutWhere, data: PayoutData): Promise<number> {
  const { count } =
    channel === "crypto" ? await tx.cryptoOrder.updateMany({ where, data }) : await tx.giftCardOrder.updateMany({ where, data });
  return count;
}

/**
 * Posts the Naira movement of an order that has just been completed outside the wallet
 * (see orderSettlementPosting). Call it in the same database transaction as the status change.
 * Safe to call for any completed order: wallet-settled orders post nothing, and the
 * reference makes a repeat a no-op.
 */
async function postOrderSettlement(tx: Db, channel: OrderChannel, orderId: string, source: string) {
  const select = { reference: true, amountNgn: true, payoutMethod: true, payoutRef: true } as const;
  const order =
    channel === "crypto"
      ? await tx.cryptoOrder.findUnique({ where: { id: orderId }, select: { ...select, side: true, paymentRef: true } })
      : await tx.giftCardOrder
          .findUnique({ where: { id: orderId }, select })
          .then((o) => (o ? { ...o, side: "SELL" as const, paymentRef: null } : null));
  if (!order) return;
  const posting = orderSettlementPosting(order);
  if (!posting) return;
  await postLedger(tx, {
    reference: `order-settled:${order.reference}`,
    kind: posting.kind,
    description:
      posting.kind === "sale_payout"
        ? `${channel === "gift" ? "Gift card" : "Crypto"} sale ${order.reference} paid out`
        : `Payment received for crypto purchase ${order.reference}`,
    source,
    lines: posting.lines,
  });
}

// ---------------------------------------------------------------- payout settlement

const UNCONFIRMED_PAYOUT_NOTE = "Paystack has not confirmed this payout. Verify before paying by hand.";
const HOLDS_LOCK: PayoutWhere = { payoutRef: { startsWith: PAYOUT_LOCK_PREFIX } };

type PayoutOutcome = "paid" | "in_flight" | "failed" | "never_sent";

/**
 * Apply a definite transfer result to a sell order. Only orders that are actually waiting
 * on a transfer move (PAYOUT_SENT, or still holding the payout lock), so repeats are no-ops.
 */
async function applyOrderPayoutOutcome(
  channel: OrderChannel,
  order: PayoutOrder,
  outcome: PayoutOutcome,
  transfer: { code: string | null; reason?: string | null; label?: string },
): Promise<boolean> {
  const r = repo[channel];
  const waiting: PayoutWhere = { id: order.id, OR: [{ status: "PAYOUT_SENT" }, HOLDS_LOCK] };

  if (outcome === "paid") {
    const count = await prisma.$transaction(async (tx) => {
      const moved = await updateOrderRows(tx, channel, waiting, {
        status: "COMPLETED",
        completedAt: new Date(),
        ...(transfer.code ? { payoutRef: transfer.code } : {}),
      });
      if (moved > 0) await postOrderSettlement(tx, channel, order.id, "provider:paystack");
      return moved;
    });
    if (count > 0) {
      const customer = await prisma.user.findUnique({ where: { id: order.userId }, select: { email: true } });
      void notifyOrderStatus({ userId: order.userId, email: customer?.email, reference: order.reference, status: "COMPLETED", channel });
      void maybeAwardReferral(order.userId);
    } else if (order.status === "REJECTED" || order.status === "CANCELLED") {
      // Money left the bank for an order we closed without paying. A person must look at this.
      log.error("desk: transfer succeeded for a closed order", { reference: order.reference, status: order.status });
      void notifyAdmin("paystack.payout_unexpected", { reference: order.reference, status: order.status, transferCode: transfer.code });
    }
    return count > 0;
  }

  if (outcome === "in_flight") {
    // Paystack has it: record the code we never received and show the order as paid out.
    if (!transfer.code || !isPayoutLock(order.payoutRef)) return false;
    const count = await r.updatePayout(
      { id: order.id, payoutRef: order.payoutRef },
      { status: "PAYOUT_SENT", payoutRef: transfer.code, completedAt: new Date(), adminNote: null },
    );
    return count > 0;
  }

  if (outcome === "failed") {
    const adminNote = `Paystack ${transfer.label ?? "failed"}: ${transfer.reason ?? "no reason given"}${
      transfer.code ? ` (${transfer.code})` : ""
    }. Pay manually and enter the bank reference.`;
    const count =
      (await r.updatePayout({ id: order.id, status: "PAYOUT_SENT" }, { status: "APPROVED", payoutRef: null, adminNote })) +
      (await r.updatePayout({ id: order.id, ...HOLDS_LOCK }, { payoutRef: null, adminNote }));
    if (count > 0) {
      void notifyAdmin("paystack.transfer_failed", {
        reference: order.reference,
        transferCode: transfer.code,
        reason: transfer.reason,
        event: transfer.label,
      });
    }
    return count > 0;
  }

  // never_sent: release exactly the lock we looked at.
  if (!isPayoutLock(order.payoutRef)) return false;
  const count = await r.updatePayout(
    { id: order.id, payoutRef: order.payoutRef },
    { payoutRef: null, adminNote: "Paystack never received the payout. Safe to pay again." },
  );
  return count > 0;
}

/**
 * Paystack webhook leg for sell-order payouts. Matches on the transfer code, or on our own
 * transfer reference when the code was never recorded. Returns null when no order matches.
 */
export async function settleOrderTransfer(input: {
  transferCode: string;
  transferRef?: string | null;
  success: boolean;
  reason?: string;
  event: string;
}) {
  const ownRef = referenceFromTransfer(input.transferRef);
  for (const channel of ["crypto", "gift"] as const) {
    const order =
      (await repo[channel].findPayout({ payoutRef: input.transferCode })) ??
      (ownRef ? await repo[channel].findPayout({ reference: ownRef }) : null);
    if (!order) continue;
    const applied = await applyOrderPayoutOutcome(channel, order, input.success ? "paid" : "failed", {
      code: input.transferCode,
      reason: input.reason,
      label: input.event.replace("transfer.", ""),
    });
    return { channel, orderId: order.id, reference: order.reference, applied };
  }
  return null;
}

/** Ask Paystack what happened to an order's payout and act only on a definite answer. */
async function resolveOrderPayout(channel: OrderChannel, order: PayoutOrder, now = Date.now()): Promise<PayoutResolution> {
  let transfer;
  try {
    transfer = await verifyTransfer(order.reference);
  } catch (err) {
    log.warn("desk: payout verify failed", { reference: order.reference, error: errorMessage(err) });
    return "error";
  }
  const verdict = payoutVerdict({ state: transfer.state, payoutRef: order.payoutRef, now });
  if (verdict !== "wait") {
    await applyOrderPayoutOutcome(channel, order, verdict, { code: transfer.transferCode, reason: transfer.reason });
  }
  return verdict;
}

/** Desk "Verify payout" button for an order that is locked or showing Payout sent. */
export async function verifyOrderPayout(
  admin: Admin,
  channel: OrderChannel,
  input: { id?: unknown },
): Promise<ServiceResult<null>> {
  if (!paystackConfigured()) return fail("Paystack is not configured.");
  const id = String(input.id ?? "").trim();
  const order = id ? await repo[channel].findPayout({ id }) : null;
  if (!order) return fail("Order not found.", 404);
  if (!isPayoutLock(order.payoutRef) && order.status !== "PAYOUT_SENT") {
    return fail(`${order.reference} has no Paystack payout in progress.`, 409);
  }
  const outcome = await resolveOrderPayout(channel, order);
  await writeAudit("admin.payout_verify", { userId: admin.id, meta: { channel, reference: order.reference, outcome } });
  const message: Record<PayoutResolution, string> = {
    paid: `Paystack confirms ${order.reference} was paid. Order completed.`,
    in_flight: `Paystack is still sending ${order.reference}. Nothing to do yet.`,
    failed: `Paystack says the payout for ${order.reference} failed. Pay manually and enter the bank reference.`,
    never_sent: `Paystack has no payout for ${order.reference}. It is safe to pay again.`,
    wait: `Paystack has no answer for ${order.reference} yet. Leave it and try again in a few minutes.`,
    error: `Could not reach Paystack to verify ${order.reference}. Try again shortly.`,
  };
  return outcome === "error" ? fail(message[outcome], 502) : ok(null, message[outcome]);
}

/** Cron leg: payouts with a lost response (still locked) or a missed webhook (stuck at Payout sent). */
export async function reconcileOrderPayouts(now = new Date()) {
  if (!paystackConfigured()) return { checked: 0, resolved: 0 };
  const where: PayoutWhere = {
    updatedAt: { lte: new Date(now.getTime() - 2 * 60_000) },
    // "TRF_" = a Paystack transfer code. Hand-typed bank references are not ours to verify.
    OR: [HOLDS_LOCK, { status: "PAYOUT_SENT", payoutRef: { startsWith: "TRF_" } }],
  };
  let checked = 0;
  let resolved = 0;
  for (const channel of ["crypto", "gift"] as const) {
    for (const order of await repo[channel].listPayouts(where, 25)) {
      checked++;
      const outcome = await resolveOrderPayout(channel, order, now.getTime());
      if (outcome === "paid" || outcome === "failed" || outcome === "never_sent") resolved++;
    }
  }
  return { checked, resolved };
}

/** Decrypt a gift code on demand. Every reveal is audited and alerted. */
export async function revealGiftCode(admin: Admin, orderId: string): Promise<ServiceResult<{ code: string }>> {
  const id = String(orderId ?? "").trim();
  if (!id) return fail("Missing order id.");

  const order = await prisma.giftCardOrder.findUnique({
    where: { id },
    select: { id: true, reference: true, cardCodeEncrypted: true, cardCodeIv: true },
  });
  if (!order) return fail("Order not found.", 404);

  let code: string;
  try {
    code = decryptSecret(order.cardCodeEncrypted, order.cardCodeIv);
  } catch {
    return fail("Could not decrypt card code. Check ENCRYPTION_KEY.", 500);
  }
  await writeAudit("admin.gift_code_reveal", {
    userId: admin.id,
    meta: { id: order.id, reference: order.reference, masked: maskSecret(code) },
  });
  void notifyAdmin("admin.gift_code_revealed", { id: order.id, reference: order.reference, adminId: admin.id });
  return ok({ code }, "Code revealed (audited).");
}

export async function updateRate(
  admin: Admin,
  input: { id?: unknown; sellRateNgn?: unknown; buyRateNgn?: unknown; isActive?: boolean },
): Promise<ServiceResult<null>> {
  const parsed = rateUpdateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid rate input");

  const before = await prisma.rate.findUnique({ where: { id: parsed.data.id } });
  if (!before) return fail("Rate not found.", 404);

  await prisma.rate.update({
    where: { id: parsed.data.id },
    data: {
      sellRateNgn: parsed.data.sellRateNgn,
      buyRateNgn: parsed.data.buyRateNgn,
      isActive: parsed.data.isActive ?? true,
    },
  });
  await writeAudit("admin.rate_update", {
    userId: admin.id,
    meta: {
      symbol: before.symbol,
      from: { sell: before.sellRateNgn, buy: before.buyRateNgn, active: before.isActive },
      to: { sell: parsed.data.sellRateNgn, buy: parsed.data.buyRateNgn, active: parsed.data.isActive ?? true },
    },
  });
  const fired = await checkRateAlerts();
  return ok(null, `${fired ? `${fired} customer alert${fired === 1 ? "" : "s"} sent. ` : ""}Rate saved: sell ${parsed.data.sellRateNgn} / buy ${parsed.data.buyRateNgn}.`);
}

/** Pull live benchmark and write desk crypto rates. Shared by admin button and cron. */
export async function syncDeskRatesFromMarket(): Promise<
  ServiceResult<{ source: string; desk: ReturnType<typeof deskQuotesFromBenchmark> }>
> {
  const [usdt, btc, eth] = await Promise.all(
    (["USDT", "BTC", "ETH"] as const).map((symbol) =>
      prisma.rate.findFirst({ where: { kind: "CRYPTO", symbol } }),
    ),
  );
  // The saved desk rate is the only fallback. With no feed and no saved rate the sync fails; it never invents a price.
  const usdtMid = usdt && usdt.sellRateNgn > 0 ? usdt.sellRateNgn : undefined;

  let benchmark;
  try {
    benchmark = await fetchReliableDeskBenchmark({
      ngnMidHint: usdtMid,
      // Derive USD hints from current desk so sync still works if CoinGecko/Binance are down.
      btcUsdHint: btc && usdtMid ? btc.sellRateNgn / usdtMid : undefined,
      ethUsdHint: eth && usdtMid ? eth.sellRateNgn / usdtMid : undefined,
    });
  } catch (err) {
    const raw = errorMessage(err);
    return fail(
      /429|busy|rate.?limit/i.test(raw)
        ? "Live feeds are busy right now. Your saved desk rates were kept - wait a minute or Save rate manually."
        : raw || "Could not sync live rates.",
      502,
    );
  }

  const desk = deskQuotesFromBenchmark(benchmark);
  await prisma.$transaction(
    (["USDT", "BTC", "ETH"] as const).map((symbol) =>
      prisma.rate.updateMany({
        where: { kind: "CRYPTO", symbol },
        data: { sellRateNgn: desk[symbol].sell, buyRateNgn: desk[symbol].buy, isActive: true },
      }),
    ),
  );
  void checkRateAlerts();
  return ok(
    { source: benchmark.source, desk },
    `Synced (${benchmark.source}). USDT ${Math.round(desk.USDT.sell)} / ${Math.round(desk.USDT.buy)}. BTC sell ${Math.round(desk.BTC.sell).toLocaleString("en-NG")}.`,
  );
}
