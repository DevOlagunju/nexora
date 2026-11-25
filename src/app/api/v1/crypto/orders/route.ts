import { prisma } from "@/lib/db";
import { createCryptoBuyOrder, createCryptoSellOrder } from "@/lib/services/trades";
import { startBuyOrderCheckout } from "@/lib/services/payments";
import { authed, data, fail, fromResult, pageSize } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/crypto/orders?limit=  The signed-in user's crypto orders, newest first. */
export const GET = authed(async ({ user, query }) =>
  data(await prisma.cryptoOrder.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: pageSize(query) })),
);

/**
 * POST /api/v1/crypto/orders  (Idempotency-Key required)
 *   sell: { side: "SELL", symbol, amountCrypto, payoutMethod: "BANK" | "WALLET", txHash? }
 *   buy:  { side: "BUY", symbol, amountCrypto, userReceiveAddress, payFrom: "BANK" | "WALLET" | "CARD", paymentRef? }
 * The price is always the desk rate on the server at this moment; the client never sends one.
 */
export const POST = authed(
  async ({ user, body, ctx }) => {
    if (body.side === "SELL") {
      return fromResult(await createCryptoSellOrder(user, body, ctx), (order) => ({ order }), 201);
    }
    if (body.side !== "BUY") return fail(400, 'side must be "SELL" or "BUY".');

    const created = await createCryptoBuyOrder(user, body, ctx);
    if (!created.ok) return fail(created.status, created.error);
    // Card payers go straight to checkout. If that fails the order still exists and can be paid later.
    const checkout = body.payFrom === "CARD" ? await startBuyOrderCheckout(user, { orderId: created.data.order.id }, ctx) : null;
    return data(
      {
        order: created.data.order,
        platformBank: created.data.platformBank,
        checkout: checkout?.ok ? checkout.data : null,
        checkoutError: checkout && !checkout.ok ? checkout.error : null,
      },
      { status: 201, message: created.message },
    );
  },
  { idempotent: true },
);
