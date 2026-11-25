import { prisma } from "@/lib/db";
import { authed, data, pageSize } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/wallets/transactions?limit=&cursor=
 * The wallet ledger, newest first. Pass "nextCursor" back as "cursor" for the next page.
 */
export const GET = authed(async ({ user, query }) => {
  const take = pageSize(query, 25);
  const cursor = query.get("cursor");
  const rows = await prisma.walletEntry.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, direction: true, amountNgn: true, reference: true, description: true, createdAt: true },
  });
  const items = rows.slice(0, take);
  return data({ items, nextCursor: rows.length > take ? items[items.length - 1].id : null });
});
