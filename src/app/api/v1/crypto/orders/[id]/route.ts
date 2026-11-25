import { prisma } from "@/lib/db";
import { cancelUnfundedOrder, submitBuyPaymentRef, submitCryptoTxHash } from "@/lib/services/trades";
import { authed, data, fail, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/crypto/orders/:id */
export const GET = authed<{ id: string }>(async ({ user, params }) => {
  const order = await prisma.cryptoOrder.findFirst({ where: { id: params.id, userId: user.id } });
  return order ? data(order) : fail(404, "Order not found.");
});

/**
 * PATCH /api/v1/crypto/orders/:id  One change per call:
 *   { txHash }               sell order: the customer's deposit transaction
 *   { paymentRef }           buy order paid by bank transfer: the bank reference
 *   { status: "CANCELLED" }  cancel an order that has not been funded
 */
export const PATCH = authed<{ id: string }>(async ({ user, params, body, ctx }) => {
  const id = params.id;
  if (typeof body.txHash === "string") {
    return fromResult(await submitCryptoTxHash(user, { id, txHash: body.txHash }, ctx), (order) => ({ order }));
  }
  if (typeof body.paymentRef === "string") {
    return fromResult(await submitBuyPaymentRef(user, { id, paymentRef: body.paymentRef }, ctx), (order) => ({ order }));
  }
  if (body.status === "CANCELLED") {
    return fromResult(await cancelUnfundedOrder(user, { id }, ctx), (order) => ({ order }));
  }
  return fail(400, 'Send one of: txHash, paymentRef, or status "CANCELLED".');
});
