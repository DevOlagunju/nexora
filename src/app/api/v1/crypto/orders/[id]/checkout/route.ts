import { startBuyOrderCheckout } from "@/lib/services/payments";
import { authed, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** POST /api/v1/crypto/orders/:id/checkout  (Idempotency-Key required)  Card / instant-transfer checkout for an unpaid buy order. */
export const POST = authed<{ id: string }>(
  async ({ user, params, ctx }) =>
    fromResult(await startBuyOrderCheckout(user, { orderId: params.id }, ctx), (checkout) => ({ checkout }), 201),
  { idempotent: true },
);
