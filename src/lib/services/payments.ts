import "server-only";
import { prisma, type Payment } from "@/lib/db";
import { orderReference } from "@/lib/crypto";
import { rateLimit, writeAudit } from "@/lib/security";
import { notifyAdmin } from "@/lib/notify";
import { errorMessage, log } from "@/lib/log";
import { formatNgn } from "@/lib/format";
import { roundNgn } from "@/lib/money";
import { fundingProblem, paymentConfig, settlementPlan } from "@/lib/payment-rules";
import { activeGatewayName, gatewayFor, TEST_CANCELLED, TEST_PAID } from "@/lib/payments/gateway";
import type { PaymentPurpose } from "@/generated/prisma/enums";
import { fail, ok, TOO_MANY, type ServiceResult } from "@/lib/services/result";
import { creditWallet, debitWallet } from "@/lib/services/wallet";
import { pushNotification } from "@/lib/services/notifications";

/**
 * Instant payment confirmation: the customer pays on the gateway's checkout, and we
 * settle as soon as the gateway confirms (webhook, return page, app poll, or the
 * reconcile sweep, whichever comes first). Every path calls settlePayment(), which
 * re-verifies with the provider and is idempotent, so double delivery is harmless.
 */

type Actor = { id: string; email: string };
/** origin = public base URL the customer's browser can reach (for the return page). */
type Ctx = { ip: string; origin: string };

export type CheckoutStart = { reference: string; authorizationUrl: string; provider: string };

export type PaymentSummary = {
  reference: string;
  purpose: PaymentPurpose;
  status: Payment["status"];
  amountNgn: number;
  paidNgn: number | null;
  orderReference: string | null;
  /** True when a card-paid buy order was funded by this payment. */
  orderFunded: boolean;
};

const lookup = (reference: string) =>
  prisma.payment.findUnique({ where: { reference }, select: { amountNgn: true, providerNote: true } });

async function kycApproved(userId: string) {
  const kyc = await prisma.kycProfile.findUnique({ where: { userId }, select: { status: true } });
  return kyc?.status === "APPROVED";
}

async function openCheckout(
  user: Actor,
  input: { purpose: PaymentPurpose; amountNgn: number; orderId?: string; label: string },
  ctx: Ctx,
): Promise<ServiceResult<CheckoutStart>> {
  const provider = activeGatewayName();
  if (!provider) return fail("Card and instant transfer payments aren't available yet. Use bank transfer.", 503);
  const gateway = gatewayFor(provider, lookup)!;

  const reference = orderReference(input.purpose === "WALLET_FUNDING" ? "NXF" : "NXP");
  const payment = await prisma.payment.create({
    data: {
      reference,
      userId: user.id,
      purpose: input.purpose,
      orderId: input.orderId,
      amountNgn: roundNgn(input.amountNgn),
      provider,
    },
  });
  try {
    const { authorizationUrl } = await gateway.initCheckout({
      reference,
      amountNgn: payment.amountNgn,
      email: user.email,
      callbackUrl: `${ctx.origin}/pay/return?reference=${encodeURIComponent(reference)}`,
      metadata: { purpose: input.purpose, label: input.label },
    });
    await writeAudit("payment.start", {
      userId: user.id,
      ip: ctx.ip,
      meta: { reference, purpose: input.purpose, amountNgn: payment.amountNgn, provider },
    });
    return ok({ reference, authorizationUrl, provider }, "Opening secure checkoutâ€¦");
  } catch (err) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", providerNote: errorMessage(err).slice(0, 200) },
    });
    log.error("payments: checkout init failed", { reference, error: errorMessage(err) });
    return fail("Couldn't open the payment page. Please try again.", 502);
  }
}

/** Add money to the Naira wallet by card / transfer / USSD. */
export async function startWalletFunding(
  user: Actor,
  input: { amountNgn?: unknown },
  ctx: Ctx,
): Promise<ServiceResult<CheckoutStart>> {
  if (!(await rateLimit(`pay:start:${user.id}`, 10))) return TOO_MANY();
  if (!(await kycApproved(user.id))) return fail("Complete KYC before adding money.", 403);
  const amount = Number(input.amountNgn);
  const problem = fundingProblem(amount, paymentConfig());
  if (problem) return fail(problem);
  return openCheckout(user, { purpose: "WALLET_FUNDING", amountNgn: amount, label: "Wallet top-up" }, ctx);
}

/** Pay an unfunded buy order by card. Used at order creation and by "Pay now" on the order. */
export async function startBuyOrderCheckout(
  user: Actor,
  input: { orderId?: unknown },
  ctx: Ctx,
): Promise<ServiceResult<CheckoutStart>> {
  if (!(await rateLimit(`pay:start:${user.id}`, 10))) return TOO_MANY();
  const orderId = String(input.orderId ?? "").trim();
  const order = await prisma.cryptoOrder.findFirst({ where: { id: orderId, userId: user.id, side: "BUY" } });
  if (!order) return fail("Order not found.", 404);
  if (order.status !== "AWAITING_DEPOSIT") return fail("This order is already paid or closed.", 409);
  return openCheckout(
    user,
    { purpose: "CRYPTO_BUY", amountNgn: order.amountNgn, orderId: order.id, label: `Order ${order.reference}` },
    ctx,
  );
}

function summarize(p: Payment, orderRef: string | null, orderFunded: boolean): PaymentSummary {
  return {
    reference: p.reference,
    purpose: p.purpose,
    status: p.status,
    amountNgn: p.amountNgn,
    paidNgn: p.paidNgn,
    orderReference: orderRef,
    orderFunded,
  };
}

async function orderInfo(p: Payment) {
  if (!p.orderId) return { ref: null, funded: false };
  const o = await prisma.cryptoOrder.findUnique({ where: { id: p.orderId }, select: { reference: true, paymentRef: true } });
  return { ref: o?.reference ?? null, funded: !!o && p.status === "SUCCESS" && o.paymentRef === `wallet:${o.reference}` };
}

/**
 * Verify with the provider and apply the result exactly once.
 * Returns null when the reference is unknown.
 */
export async function settlePayment(reference: string, source: string): Promise<PaymentSummary | null> {
  const p = await prisma.payment.findUnique({ where: { reference } });
  if (!p) return null;
  if (p.status === "SUCCESS") {
    const info = await orderInfo(p);
    return summarize(p, info.ref, info.funded);
  }

  const gateway = gatewayFor(p.provider, lookup);
  if (!gateway) {
    log.warn("payments: provider unavailable for verify", { reference, provider: p.provider });
    return summarize(p, null, false);
  }

  let v;
  try {
    v = await gateway.verify(reference);
  } catch (err) {
    log.warn("payments: verify failed", { reference, source, error: errorMessage(err) });
    const info = await orderInfo(p);
    return summarize(p, info.ref, false);
  }

  if (v.state === "pending") {
    const info = await orderInfo(p);
    return summarize(p, info.ref, false);
  }

  if (v.state === "failed" || v.state === "abandoned") {
    await prisma.payment.updateMany({
      where: { id: p.id, status: "PENDING" },
      data: { status: v.state === "failed" ? "FAILED" : "ABANDONED", providerNote: v.message?.slice(0, 200) },
    });
    const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    const info = await orderInfo(fresh);
    return summarize(fresh, info.ref, false);
  }

  const plan = settlementPlan({ purpose: p.purpose, expectedNgn: p.amountNgn, paidNgn: v.paidNgn, currency: v.currency });
  if (!plan.ok) {
    await prisma.payment.updateMany({ where: { id: p.id, status: { not: "SUCCESS" } }, data: { providerNote: plan.reason } });
    log.error("payments: verified payment rejected", { reference, reason: plan.reason });
    void notifyAdmin("payment.needs_review", { reference, reason: plan.reason, userId: p.userId });
    return summarize(p, null, false);
  }

  const result = await prisma.$transaction(async (tx) => {
    const { count } = await tx.payment.updateMany({
      where: { id: p.id, status: { not: "SUCCESS" } },
      data: {
        status: "SUCCESS",
        paidNgn: plan.creditNgn,
        channel: v.channel,
        paidAt: v.paidAt ?? new Date(),
        providerNote: plan.note,
      },
    });
    if (count === 0) return null; // someone else settled it first

    const order = p.orderId ? await tx.cryptoOrder.findUnique({ where: { id: p.orderId } }) : null;
    await creditWallet(tx, {
      userId: p.userId,
      amountNgn: plan.creditNgn,
      reference: `fund:${p.reference}`,
      kind: "deposit",
      source: `provider:${p.provider}`,
      description: order ? `Card payment for order ${order.reference}` : `Added money (${v.channel ?? "card"})`,
    });

    let funded = false;
    if (plan.fundsOrder && order && order.side === "BUY") {
      const moved = await tx.cryptoOrder.updateMany({
        where: { id: order.id, status: "AWAITING_DEPOSIT" },
        data: { status: "UNDER_REVIEW", paymentRef: `wallet:${order.reference}` },
      });
      if (moved.count > 0) {
        const debited = await debitWallet(tx, {
          userId: p.userId,
          amountNgn: order.amountNgn,
          reference: `buy:${order.reference}`,
          kind: "purchase",
          source: `customer:${p.userId}`,
          description: `Bought ${order.amountCrypto} ${order.symbol} (${order.reference})`,
        });
        // We just credited at least this much, so this can only fail on a concurrent spend; retry later.
        if (!debited) throw new Error("Wallet debit failed after credit");
        funded = true;
      }
    }
    return { order, funded };
  });

  const fresh = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
  if (!result) {
    const info = await orderInfo(fresh);
    return summarize(fresh, info.ref, info.funded);
  }

  const { order, funded } = result;
  await writeAudit("payment.success", {
    userId: p.userId,
    meta: { reference, source, paidNgn: plan.creditNgn, channel: v.channel, orderFunded: funded },
  });
  if (funded && order) {
    void pushNotification(p.userId, {
      title: "Payment confirmed",
      body: `${formatNgn(order.amountNgn)} received for ${order.reference}. We're sending your ${order.amountCrypto} ${order.symbol} now.`,
      href: "/dashboard/orders",
    });
    void notifyAdmin("crypto.buy_paid_instant", {
      reference: order.reference,
      symbol: order.symbol,
      amountCrypto: order.amountCrypto,
      amountNgn: order.amountNgn,
      payment: reference,
    });
  } else {
    void pushNotification(p.userId, {
      title: "Money added",
      body: order
        ? `${formatNgn(plan.creditNgn)} is in your wallet. Order ${order.reference} couldn't be funded (${plan.note ?? "it was closed"}), so the money stays in your wallet.`
        : `${formatNgn(plan.creditNgn)} has been added to your wallet.`,
      href: "/dashboard/wallet",
    });
  }
  return summarize(fresh, order?.reference ?? null, funded);
}

/** Customer-facing status check; nudges verification while still pending. */
export async function paymentStatusFor(user: Actor, reference: string): Promise<ServiceResult<PaymentSummary>> {
  const p = await prisma.payment.findFirst({ where: { reference, userId: user.id } });
  if (!p) return fail("Payment not found.", 404);
  if (p.status === "PENDING" && (await rateLimit(`pay:check:${user.id}`, 40))) {
    const s = await settlePayment(reference, "status-check");
    if (s) return ok(s);
  }
  const info = await orderInfo(p);
  return ok(summarize(p, info.ref, info.funded));
}

/** Cron safety net for missed webhooks / closed browsers. */
export async function reconcilePendingPayments(now = new Date()) {
  const cfg = paymentConfig();
  const pending = await prisma.payment.findMany({
    where: { status: "PENDING", createdAt: { lte: new Date(now.getTime() - 60_000) } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  let settled = 0;
  let abandoned = 0;
  for (const p of pending) {
    const s = await settlePayment(p.reference, "reconcile");
    if (s?.status === "SUCCESS") settled++;
    else if (s?.status === "PENDING" && now.getTime() - p.createdAt.getTime() > cfg.abandonAfterHours * 3_600_000) {
      const { count } = await prisma.payment.updateMany({
        where: { id: p.id, status: "PENDING" },
        data: { status: "ABANDONED", providerNote: "Expired without payment" },
      });
      abandoned += count;
    }
  }
  return { checked: pending.length, settled, abandoned };
}

export function listRecentPayments(userId: string, take = 10) {
  return prisma.payment.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });
}

/** Test checkout only (non-production): record the simulated outcome, then settle. */
export async function completeTestPayment(reference: string, outcome: "paid" | "cancelled") {
  const p = await prisma.payment.findUnique({ where: { reference } });
  if (!p || p.provider !== "test" || p.status !== "PENDING") return null;
  await prisma.payment.update({ where: { id: p.id }, data: { providerNote: outcome === "paid" ? TEST_PAID : TEST_CANCELLED } });
  return settlePayment(reference, "test-checkout");
}
