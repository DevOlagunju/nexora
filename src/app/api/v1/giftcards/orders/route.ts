import { prisma } from "@/lib/db";
import { GIFT_ORDER_FIELDS } from "@/lib/api/shapes";
import { createGiftCardSellOrder } from "@/lib/services/trades";
import { authed, data, fromResult, pageSize } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/giftcards/orders?limit=  The card code is never returned, encrypted or otherwise. */
export const GET = authed(async ({ user, query }) =>
  data(
    await prisma.giftCardOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: pageSize(query),
      select: GIFT_ORDER_FIELDS,
    }),
  ),
);

/**
 * POST /api/v1/giftcards/orders  (Idempotency-Key required)
 *   { brand, country?, faceValueUsd, cardCode, payoutMethod: "BANK" | "WALLET" }
 * The code is encrypted before it is stored and is not echoed back.
 */
export const POST = authed(
  async ({ user, body, ctx }) => fromResult(await createGiftCardSellOrder(user, body, ctx), (order) => ({ order }), 201),
  { idempotent: true },
);
