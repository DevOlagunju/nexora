import "server-only";
import { prisma } from "@/lib/db";
import { medianMinutes } from "@/lib/alert-rules";

/**
 * Public desk transparency: how fast sells actually get paid. Shown on the dashboard and rates page
 * so customers can judge us on real numbers, not promises.
 */
export async function getDeskSpeed(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const where = { status: "COMPLETED" as const, completedAt: { gte: since } };
  const [crypto, gift] = await Promise.all([
    prisma.cryptoOrder.findMany({
      where: { ...where, side: "SELL" },
      select: { createdAt: true, completedAt: true },
      take: 500,
      orderBy: { completedAt: "desc" },
    }),
    prisma.giftCardOrder.findMany({
      where,
      select: { createdAt: true, completedAt: true },
      take: 500,
      orderBy: { completedAt: "desc" },
    }),
  ]);
  const dur = (rows: { createdAt: Date; completedAt: Date | null }[]) =>
    rows.map((r) => (r.completedAt ? r.completedAt.getTime() - r.createdAt.getTime() : NaN));
  return {
    days,
    cryptoMedianMin: medianMinutes(dur(crypto)),
    giftMedianMin: medianMinutes(dur(gift)),
    completed: crypto.length + gift.length,
  };
}
