import { prisma } from "@/lib/db";
import { GIFT_ORDER_FIELDS } from "@/lib/api/shapes";
import { authed, data, fail } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/giftcards/orders/:id */
export const GET = authed<{ id: string }>(async ({ user, params }) => {
  const order = await prisma.giftCardOrder.findFirst({ where: { id: params.id, userId: user.id }, select: GIFT_ORDER_FIELDS });
  return order ? data(order) : fail(404, "Order not found.");
});
