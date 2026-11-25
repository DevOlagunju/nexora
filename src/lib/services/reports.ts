import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/security";
import { addNgn, subNgn, sumNgn } from "@/lib/money";
import { startOfLagosDay } from "@/lib/trade-limits";
import { cryptoEarning, giftEarning, summarise, type Line } from "@/lib/earnings-rules";
import { SYSTEM_ACCOUNTS } from "@/lib/ledger/accounts";
import { fail, ok, type ServiceResult } from "@/lib/services/result";

/**
 * Earnings: what completed trades earned and the fees booked, for a period. Read-only.
 * Spread earnings are expected values at the market price of each trade; costs paid to
 * outside providers (payment gateway, exchanges, network fees) are not in here yet.
 */

export type EarningsReport = {
  from: Date;
  to: Date;
  crypto: Line[];
  gift: Line[];
  feesNgn: number;
  totalNgn: number;
  /** Completed trades whose earning cannot be worked out yet (no market price, or redemption not recorded). */
  unpriced: number;
};

export async function earningsReport(from: Date, to: Date): Promise<EarningsReport> {
  const completedIn = { status: "COMPLETED" as const, completedAt: { gte: from, lt: to } };
  const [cryptoOrders, giftOrders, feeEntries] = await Promise.all([
    prisma.cryptoOrder.findMany({
      where: completedIn,
      select: { symbol: true, side: true, amountCrypto: true, rateNgn: true, amountNgn: true, marketRateNgn: true },
    }),
    prisma.giftCardOrder.findMany({ where: completedIn, select: { brand: true, amountNgn: true, redeemedNgn: true } }),
    prisma.ledgerEntry.findMany({
      where: { account: { code: SYSTEM_ACCOUNTS.feeRevenue }, transaction: { postedAt: { gte: from, lt: to } } },
      select: { direction: true, amount: true },
    }),
  ]);

  const crypto = summarise(cryptoOrders, (o) => `${o.symbol} ${o.side === "SELL" ? "bought from customers" : "sold to customers"}`, (o) => o.amountNgn, cryptoEarning);
  const gift = summarise(giftOrders, (o) => o.brand, (o) => o.amountNgn, giftEarning);
  // Revenue grows with credits.
  const feesNgn = subNgn(
    sumNgn(feeEntries.filter((e) => e.direction === "CREDIT").map((e) => e.amount)),
    sumNgn(feeEntries.filter((e) => e.direction === "DEBIT").map((e) => e.amount)),
  );
  const tradeEarnings = sumNgn([...crypto, ...gift].map((l) => l.earnedNgn));
  return {
    from,
    to,
    crypto,
    gift,
    feesNgn,
    totalNgn: addNgn(tradeEarnings, feesNgn),
    unpriced: [...crypto, ...gift].reduce((n, l) => n + l.unpriced, 0),
  };
}

/** Today, the last 7 days and the last 30 days, in Lagos time. */
export async function earningsOverview(now = new Date()) {
  const today = startOfLagosDay(now);
  const day = 24 * 3_600_000;
  const [d1, d7, d30] = await Promise.all([
    earningsReport(today, now),
    earningsReport(new Date(today.getTime() - 6 * day), now),
    earningsReport(new Date(today.getTime() - 29 * day), now),
  ]);
  return { today: d1, week: d7, month: d30 };
}

const redemptionSchema = z.object({
  id: z.string().min(1),
  redeemedNgn: z.coerce.number({ error: "Enter what the card was redeemed or sold for." }).min(0).max(100_000_000),
});

/**
 * The desk records what it got for a gift card (redeemed or resold), so the report can show what
 * the card earned. Can be corrected later; every change is audited with the old and new value.
 */
export async function recordGiftRedemption(admin: { id: string }, input: unknown): Promise<ServiceResult<null>> {
  const parsed = redemptionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const order = await prisma.giftCardOrder.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, reference: true, status: true, amountNgn: true, redeemedNgn: true },
  });
  if (!order) return fail("Order not found.", 404);
  if (order.status === "REJECTED" || order.status === "CANCELLED" || order.status === "AWAITING_DEPOSIT") {
    return fail("Only cards that were accepted can have a redemption value.", 409);
  }
  await prisma.giftCardOrder.update({ where: { id: order.id }, data: { redeemedNgn: parsed.data.redeemedNgn } });
  await writeAudit("admin.gift_redemption", {
    userId: admin.id,
    meta: { reference: order.reference, from: order.redeemedNgn, to: parsed.data.redeemedNgn, paidNgn: order.amountNgn },
  });
  const margin = subNgn(parsed.data.redeemedNgn, order.amountNgn);
  return ok(null, `${order.reference}: redeemed for ₦${parsed.data.redeemedNgn.toLocaleString("en-NG")}, ${margin >= 0 ? "earning" : "losing"} ₦${Math.abs(margin).toLocaleString("en-NG")}.`);
}
