import "server-only";
import { prisma } from "@/lib/db";
import { addNgn, numberFrom } from "@/lib/money";
import { getDailyUsage } from "@/lib/trade-limits";
import { platformBankDetails } from "@/lib/platform-bank";
import { supportWhatsAppUrl } from "@/lib/support";
import { getDeskSpeed } from "@/lib/desk-stats";
import type { OrderStatus } from "@/generated/prisma/enums";

/** Statuses where money is still moving and the customer should keep an eye on the order. */
export const OPEN_STATUSES: OrderStatus[] = ["AWAITING_DEPOSIT", "UNDER_REVIEW", "APPROVED", "PAYOUT_SENT"];
const PAID_STATUSES: OrderStatus[] = ["PAYOUT_SENT", "COMPLETED"];

export type ActivityItem = {
  id: string;
  kind: "crypto-sell" | "crypto-buy" | "gift";
  reference: string;
  title: string;
  subtitle: string;
  amountNgn: number;
  status: OrderStatus;
  createdAt: Date;
  adminNote: string | null;
};

export type ActionItem = {
  id: string;
  reference: string;
  side: "SELL" | "BUY";
  symbol: string;
  network: string;
  amountCrypto: number;
  amountNgn: number;
  createdAt: Date;
  /** Where the customer sends funds: wallet (sell) or bank (buy). */
  payTo: { label: string; value: string; detail?: string };
};

/** Pure: merge crypto + gift rows into one newest-first feed (unit tested). */
export function buildActivity(
  crypto: Array<{
    id: string;
    reference: string;
    side: "SELL" | "BUY";
    symbol: string;
    amountCrypto: number;
    amountNgn: number;
    status: OrderStatus;
    createdAt: Date;
    adminNote: string | null;
  }>,
  gift: Array<{
    id: string;
    reference: string;
    brand: string;
    country: string;
    faceValueUsd: number;
    amountNgn: number;
    status: OrderStatus;
    createdAt: Date;
    adminNote: string | null;
  }>,
  limit = 8,
): ActivityItem[] {
  const items: ActivityItem[] = [
    ...crypto.map((o) => ({
      id: o.id,
      kind: (o.side === "SELL" ? "crypto-sell" : "crypto-buy") as ActivityItem["kind"],
      reference: o.reference,
      title: `${o.side === "SELL" ? "Sell" : "Buy"} ${o.amountCrypto} ${o.symbol}`,
      subtitle: o.reference,
      amountNgn: o.amountNgn,
      status: o.status,
      createdAt: o.createdAt,
      adminNote: o.adminNote,
    })),
    ...gift.map((o) => ({
      id: o.id,
      kind: "gift" as const,
      reference: o.reference,
      title: `${o.brand.charAt(0)}${o.brand.slice(1).toLowerCase()} gift card · $${o.faceValueUsd}`,
      subtitle: `${o.reference} · ${o.country}`,
      amountNgn: o.amountNgn,
      status: o.status,
      createdAt: o.createdAt,
      adminNote: o.adminNote,
    })),
  ];
  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}

export async function loadDashboard(userId: string) {
  // Aggregates come straight from the database as decimals, whatever the row types say.
  const sum = (r: { _sum: { amountNgn: unknown } }) => numberFrom(r._sum.amountNgn as Parameters<typeof numberFrom>[0]);

  const [
    kyc,
    recentCrypto,
    recentGift,
    awaiting,
    rates,
    paidCrypto,
    paidGift,
    openCrypto,
    openGift,
    completedCrypto,
    completedGift,
    usage,
    me,
    deskSpeed,
  ] = await Promise.all([
    prisma.kycProfile.findUnique({ where: { userId } }),
    prisma.cryptoOrder.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.giftCardOrder.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        reference: true,
        brand: true,
        country: true,
        faceValueUsd: true,
        amountNgn: true,
        status: true,
        createdAt: true,
        adminNote: true,
      },
    }),
    prisma.cryptoOrder.findMany({
      where: { userId, status: "AWAITING_DEPOSIT" },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
    prisma.rate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.cryptoOrder.aggregate({
      where: { userId, side: "SELL", status: { in: PAID_STATUSES } },
      _sum: { amountNgn: true },
    }),
    prisma.giftCardOrder.aggregate({
      where: { userId, status: { in: PAID_STATUSES } },
      _sum: { amountNgn: true },
    }),
    prisma.cryptoOrder.aggregate({
      where: { userId, status: { in: OPEN_STATUSES } },
      _sum: { amountNgn: true },
      _count: true,
    }),
    prisma.giftCardOrder.aggregate({
      where: { userId, status: { in: OPEN_STATUSES } },
      _sum: { amountNgn: true },
      _count: true,
    }),
    prisma.cryptoOrder.count({ where: { userId, status: "COMPLETED" } }),
    prisma.giftCardOrder.count({ where: { userId, status: "COMPLETED" } }),
    getDailyUsage(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { walletBalanceNgn: true } }),
    getDeskSpeed(7),
  ]);

  const bank = platformBankDetails();
  const actions: ActionItem[] = awaiting.map((o) => ({
    id: o.id,
    reference: o.reference,
    side: o.side,
    symbol: o.symbol,
    network: o.network,
    amountCrypto: o.amountCrypto,
    amountNgn: o.amountNgn,
    createdAt: o.createdAt,
    payTo:
      o.side === "SELL"
        ? { label: `${o.symbol} deposit address (${o.network})`, value: o.depositAddress ?? "" }
        : { label: `${bank.bankName} · ${bank.accountName}`, value: bank.accountNumber, detail: "Use your order reference as narration" },
  }));

  // Orders already with the desk. Unfunded ones live in `actions` instead, so nothing shows twice.
  const withDesk = (s: OrderStatus) => OPEN_STATUSES.includes(s) && s !== "AWAITING_DEPOSIT";
  const activeOrders = buildActivity(
    recentCrypto.filter((o) => withDesk(o.status)),
    recentGift.filter((o) => withDesk(o.status)),
    3,
  );

  const crypto = rates.filter((r) => r.kind === "CRYPTO");
  const gifts = rates.filter((r) => r.kind === "GIFTCARD");
  const usdt = crypto.find((r) => r.symbol === "USDT");
  const bestGift = gifts.reduce<(typeof gifts)[number] | undefined>(
    (best, r) => (!best || r.sellRateNgn > best.sellRateNgn ? r : best),
    undefined,
  );

  return {
    kyc,
    stats: {
      paidOutNgn: addNgn(sum(paidCrypto), sum(paidGift)),
      inProgressNgn: addNgn(sum(openCrypto), sum(openGift)),
      inProgressCount: openCrypto._count + openGift._count,
      completedCount: completedCrypto + completedGift,
      walletNgn: Math.max(0, me?.walletBalanceNgn ?? 0),
    },
    deskSpeed,
    actions,
    activeOrders,
    activity: buildActivity(recentCrypto, recentGift, 8),
    rates: {
      all: rates.map((r) => ({
        symbol: r.symbol,
        displayName: r.displayName,
        sellRateNgn: r.sellRateNgn,
        buyRateNgn: r.buyRateNgn,
        kind: r.kind,
      })),
      usdtSell: usdt?.sellRateNgn ?? null,
      usdtBuy: usdt?.buyRateNgn ?? null,
      bestGift: bestGift ? { name: bestGift.displayName, rate: bestGift.sellRateNgn } : null,
      updatedAt: rates.reduce<Date | null>((m, r) => (!m || r.updatedAt > m ? r.updatedAt : m), null),
    },
    usage,
    supportUrl: supportWhatsAppUrl("Hi Nexora support, I need help with my account."),
  };
}

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;
