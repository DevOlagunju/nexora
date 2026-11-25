import { prisma } from "@/lib/db";
import { data, open } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/rates?kind=CRYPTO|GIFTCARD  Current desk rates in Naira per unit, with when each was last changed. */
export const GET = open(async ({ query }) => {
  const kind = query.get("kind");
  const rates = await prisma.rate.findMany({
    where: { isActive: true, ...(kind === "CRYPTO" || kind === "GIFTCARD" ? { kind } : {}) },
    orderBy: { sortOrder: "asc" },
    select: {
      kind: true,
      symbol: true,
      displayName: true,
      sellRateNgn: true,
      buyRateNgn: true,
      minAmount: true,
      maxAmount: true,
      updatedAt: true,
    },
  });
  return data(rates);
});
