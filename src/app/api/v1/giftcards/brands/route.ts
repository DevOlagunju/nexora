import { prisma } from "@/lib/db";
import { data, open } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/giftcards/brands  Gift card brands the desk is buying, with the Naira rate per $1 of face value. */
export const GET = open(async () => {
  const brands = await prisma.rate.findMany({
    where: { kind: "GIFTCARD", isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { symbol: true, displayName: true, sellRateNgn: true, minAmount: true, maxAmount: true, updatedAt: true },
  });
  return data(
    brands.map((b) => ({
      brand: b.symbol,
      displayName: b.displayName,
      sellRateNgn: b.sellRateNgn,
      minFaceValueUsd: b.minAmount,
      maxFaceValueUsd: b.maxAmount,
      updatedAt: b.updatedAt,
    })),
  );
});
