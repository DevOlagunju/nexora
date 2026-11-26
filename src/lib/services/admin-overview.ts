import "server-only";
import { prisma } from "@/lib/db";
import { cryptoEarning, giftEarning } from "@/lib/earnings-rules";
import { SYSTEM_ACCOUNTS } from "@/lib/ledger/accounts";
import { paystackConfigured } from "@/lib/paystack";
import { activeDepositProvider } from "@/lib/deposits/provider";
import { bucketIndex, buckets, OVERVIEW_RANGES, pctChange, successRate, type OverviewRange } from "@/lib/admin-overview-rules";

/**
 * Everything the admin overview shows, from the database. Read-only. Figures that the data
 * cannot support (uptime history, response times) are not shown rather than made up.
 */

const FAILED_STATUSES = ["REJECTED", "CANCELLED"] as const;
const DEPOSIT_EXCEPTIONS = ["UNDERPAID", "OVERPAID", "UNMATCHED", "WRONG_ASSET", "REVERSED"] as const;

export type Kpi = { value: number; change: number | null; series: number[] };

export type ActivityItem = {
  kind: "deposit" | "gift" | "kyc" | "flag" | "signup";
  title: string;
  detail: string;
  at: Date;
  amountNgn?: number;
};

export type TransactionRow = {
  id: string;
  type: "Sell Crypto" | "Buy Crypto" | "Gift Card" | "Withdrawal" | "Deposit";
  symbol?: string;
  user: string;
  amountNgn: number;
  amountLabel?: string;
  status: string;
  at: Date;
};

export type PendingItem = {
  id: string;
  kind: "crypto" | "gift" | "withdrawal" | "kyc" | "approval" | "deposit" | "fraud";
  title: string;
  detail: string;
  at: Date;
  href: string;
  action: "Review" | "Investigate";
};

export type StatusCheck = { name: string; ok: boolean; detail: string };

const who = (u: { email: string; fullName: string } | null | undefined) => (u ? `@${u.email.split("@")[0]}` : "unknown");

export async function adminOverview(range: OverviewRange, now = new Date()) {
  const list = buckets(range, now);
  const from = list[0].start;
  const span = now.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - span);
  const inWindow = { gte: prevFrom, lte: now };

  const [
    totalUsers,
    usersBeforeFrom,
    usersBeforePrev,
    newUsers,
    completedCrypto,
    completedGift,
    failedCrypto,
    failedGift,
    feeEntries,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "USER" } }),
    prisma.user.count({ where: { role: "USER", createdAt: { lt: from } } }),
    prisma.user.count({ where: { role: "USER", createdAt: { lt: prevFrom } } }),
    prisma.user.findMany({ where: { role: "USER", createdAt: { gte: from } }, select: { createdAt: true } }),
    prisma.cryptoOrder.findMany({
      where: { status: "COMPLETED", completedAt: inWindow },
      select: { completedAt: true, amountNgn: true, symbol: true, side: true, amountCrypto: true, rateNgn: true, marketRateNgn: true },
    }),
    prisma.giftCardOrder.findMany({
      where: { status: "COMPLETED", completedAt: inWindow },
      select: { completedAt: true, amountNgn: true, redeemedNgn: true, brand: true },
    }),
    prisma.cryptoOrder.findMany({ where: { status: { in: [...FAILED_STATUSES] }, updatedAt: inWindow }, select: { updatedAt: true } }),
    prisma.giftCardOrder.findMany({ where: { status: { in: [...FAILED_STATUSES] }, updatedAt: inWindow }, select: { updatedAt: true } }),
    prisma.ledgerEntry.findMany({
      where: { account: { code: SYSTEM_ACCOUNTS.feeRevenue }, transaction: { postedAt: inWindow } },
      select: { direction: true, amount: true, transaction: { select: { postedAt: true } } },
    }),
  ]);

  const isCurrent = (t: Date) => t.getTime() >= from.getTime();
  const n = list.length;
  const zeros = () => new Array<number>(n).fill(0);

  // Trade volume and what it earned, per bucket and for the previous period.
  const volume = zeros();
  const revenue = zeros();
  const completedPer = zeros();
  let volumeNow = 0;
  let volumePrev = 0;
  let revenueNow = 0;
  let revenuePrev = 0;
  let completedNow = 0;
  let completedPrev = 0;
  const trades = [
    ...completedCrypto.map((o) => ({ at: o.completedAt!, amount: o.amountNgn, earned: cryptoEarning(o) ?? 0 })),
    ...completedGift.map((o) => ({ at: o.completedAt!, amount: o.amountNgn, earned: giftEarning(o) ?? 0 })),
  ];
  for (const t of trades) {
    if (isCurrent(t.at)) {
      volumeNow += t.amount;
      revenueNow += t.earned;
      completedNow++;
      const i = bucketIndex(list, t.at);
      if (i >= 0) {
        volume[i] += t.amount;
        revenue[i] += t.earned;
        completedPer[i]++;
      }
    } else {
      volumePrev += t.amount;
      revenuePrev += t.earned;
      completedPrev++;
    }
  }
  for (const e of feeEntries) {
    const amount = e.direction === "CREDIT" ? e.amount : -e.amount;
    const at = e.transaction.postedAt;
    if (isCurrent(at)) {
      revenueNow += amount;
      const i = bucketIndex(list, at);
      if (i >= 0) revenue[i] += amount;
    } else revenuePrev += amount;
  }

  // Success rate: completed trades out of all trades that ended.
  const failedPer = zeros();
  let failedNow = 0;
  let failedPrev = 0;
  for (const f of [...failedCrypto, ...failedGift]) {
    if (isCurrent(f.updatedAt)) {
      failedNow++;
      const i = bucketIndex(list, f.updatedAt);
      if (i >= 0) failedPer[i]++;
    } else failedPrev++;
  }
  const rateNow = successRate(completedNow, failedNow);
  const ratePrev = successRate(completedPrev, failedPrev);
  // Carry the last known rate across buckets with no finished trades, so the line doesn't drop to 0.
  let carry = rateNow ?? 0;
  const ratePer = completedPer.map((c, i) => {
    const r = successRate(c, failedPer[i]);
    if (r !== null) carry = r;
    return carry;
  });

  // Users: running total at the end of each bucket, and sign-ups per bucket for the chart.
  const signups = zeros();
  for (const u of newUsers) {
    const i = bucketIndex(list, u.createdAt);
    if (i >= 0) signups[i]++;
  }
  let running = usersBeforeFrom;
  const userTotals = signups.map((s) => (running += s));

  return {
    range,
    rangeLabel: OVERVIEW_RANGES[range].label,
    labels: list.map((b) => b.label),
    kpis: {
      users: {
        value: totalUsers,
        // Growth of the user base over the period, against the growth over the period before.
        change: pctChange(totalUsers, usersBeforeFrom),
        series: userTotals,
        newInPeriod: newUsers.length,
        prevNew: usersBeforeFrom - usersBeforePrev,
      },
      volume: { value: volumeNow, change: pctChange(volumeNow, volumePrev), series: volume },
      revenue: { value: revenueNow, change: pctChange(revenueNow, revenuePrev), series: revenue },
      success: {
        value: rateNow,
        // Percentage points, not percent of a percent.
        change: rateNow !== null && ratePrev !== null ? rateNow - ratePrev : null,
        series: ratePer,
        trades: completedNow + failedNow,
      },
    },
    chart: { volume, signups },
  };
}

/** The latest things that happened, newest first. */
export async function recentActivity(limit = 5): Promise<ActivityItem[]> {
  const [payments, gifts, kycs, flagged, exceptions, signups] = await Promise.all([
    prisma.payment.findMany({ where: { status: "SUCCESS", purpose: "WALLET_FUNDING" }, orderBy: { paidAt: "desc" }, take: limit, include: { user: { select: { email: true, fullName: true } } } }),
    prisma.giftCardOrder.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { user: { select: { email: true, fullName: true } } } }),
    prisma.kycProfile.findMany({ where: { status: "APPROVED", reviewedAt: { not: null } }, orderBy: { reviewedAt: "desc" }, take: limit, include: { user: { select: { email: true, fullName: true } } } }),
    prisma.giftCardOrder.findMany({ where: { fraudFlag: true }, orderBy: { createdAt: "desc" }, take: limit, include: { user: { select: { email: true, fullName: true } } } }),
    prisma.blockchainDeposit.findMany({ where: { status: { in: [...DEPOSIT_EXCEPTIONS] } }, orderBy: { firstSeenAt: "desc" }, take: limit }),
    prisma.user.findMany({ where: { role: "USER" }, orderBy: { createdAt: "desc" }, take: limit, select: { email: true, fullName: true, createdAt: true } }),
  ]);
  const items: ActivityItem[] = [
    ...payments.map((p) => ({ kind: "deposit" as const, title: "Wallet top-up", detail: who(p.user), at: p.paidAt ?? p.updatedAt, amountNgn: p.paidNgn ?? p.amountNgn })),
    ...gifts.map((g) => ({ kind: "gift" as const, title: "Gift card submitted", detail: `$${g.faceValueUsd} ${g.brand} · ${who(g.user)}`, at: g.createdAt })),
    ...kycs.map((k) => ({ kind: "kyc" as const, title: "KYC approved", detail: who(k.user), at: k.reviewedAt! })),
    ...flagged.map((g) => ({ kind: "flag" as const, title: "Gift card flagged", detail: `${g.reference} · ${who(g.user)}`, at: g.createdAt })),
    ...exceptions.map((d) => ({ kind: "flag" as const, title: `Deposit ${d.status.toLowerCase().replace("_", " ")}`, detail: `${d.amount} ${d.symbol} on ${d.network}`, at: d.firstSeenAt })),
    ...signups.map((u) => ({ kind: "signup" as const, title: "New customer", detail: who(u), at: u.createdAt })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** The latest money movements of every kind, newest first. */
export async function recentTransactions(limit = 6): Promise<TransactionRow[]> {
  const user = { select: { email: true, fullName: true } } as const;
  const [crypto, gift, withdrawals, deposits] = await Promise.all([
    prisma.cryptoOrder.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { user } }),
    prisma.giftCardOrder.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { user } }),
    prisma.withdrawal.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { user } }),
    prisma.payment.findMany({ where: { purpose: "WALLET_FUNDING" }, orderBy: { createdAt: "desc" }, take: limit, include: { user } }),
  ]);
  const rows: TransactionRow[] = [
    ...crypto.map((o) => ({
      id: o.id,
      type: o.side === "SELL" ? ("Sell Crypto" as const) : ("Buy Crypto" as const),
      symbol: o.symbol,
      user: who(o.user),
      amountNgn: o.amountNgn,
      status: o.status,
      at: o.createdAt,
    })),
    ...gift.map((o) => ({ id: o.id, type: "Gift Card" as const, user: who(o.user), amountNgn: o.amountNgn, amountLabel: `$${o.faceValueUsd} ${o.brand}`, status: o.status, at: o.createdAt })),
    ...withdrawals.map((w) => ({ id: w.id, type: "Withdrawal" as const, user: who(w.user), amountNgn: w.amountNgn, status: w.status, at: w.createdAt })),
    ...deposits.map((p) => ({ id: p.id, type: "Deposit" as const, user: who(p.user), amountNgn: p.amountNgn, status: p.status, at: p.createdAt })),
  ];
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** Work waiting for staff, oldest first within each kind, with a link to the desk section. */
export async function pendingWork(limit = 5): Promise<{ total: number; items: PendingItem[] }> {
  const user = { select: { email: true, fullName: true } } as const;
  const [crypto, gift, withdrawals, kyc, approvals, exceptions, fraud, counts] = await Promise.all([
    prisma.cryptoOrder.findMany({ where: { status: "UNDER_REVIEW" }, orderBy: { createdAt: "asc" }, take: limit, include: { user } }),
    prisma.giftCardOrder.findMany({ where: { status: "UNDER_REVIEW", fraudFlag: false }, orderBy: { createdAt: "asc" }, take: limit, include: { user } }),
    prisma.withdrawal.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: limit, include: { user } }),
    prisma.kycProfile.findMany({ where: { status: "PENDING" }, orderBy: { submittedAt: "asc" }, take: limit, include: { user } }),
    prisma.approvalRequest.findMany({ where: { status: "PENDING", expiresAt: { gt: new Date() } }, orderBy: { requestedAt: "asc" }, take: limit }),
    prisma.blockchainDeposit.findMany({ where: { status: { in: [...DEPOSIT_EXCEPTIONS] } }, orderBy: { firstSeenAt: "asc" }, take: limit }),
    prisma.giftCardOrder.findMany({ where: { fraudFlag: true, status: { in: ["UNDER_REVIEW", "APPROVED"] } }, orderBy: { createdAt: "asc" }, take: limit, include: { user } }),
    Promise.all([
      prisma.cryptoOrder.count({ where: { status: "UNDER_REVIEW" } }),
      prisma.giftCardOrder.count({ where: { status: "UNDER_REVIEW" } }),
      prisma.withdrawal.count({ where: { status: "PENDING" } }),
      prisma.kycProfile.count({ where: { status: "PENDING" } }),
      prisma.approvalRequest.count({ where: { status: "PENDING", expiresAt: { gt: new Date() } } }),
      prisma.blockchainDeposit.count({ where: { status: { in: [...DEPOSIT_EXCEPTIONS] } } }),
    ]),
  ]);
  const items: PendingItem[] = [
    ...fraud.map((g) => ({ id: g.id, kind: "fraud" as const, title: `Risk alert ${g.reference}`, detail: g.fraudNote ?? `$${g.faceValueUsd} ${g.brand} · ${who(g.user)}`, at: g.createdAt, href: "/admin/desk#gift", action: "Investigate" as const })),
    ...exceptions.map((d) => ({ id: d.id, kind: "deposit" as const, title: `Deposit ${d.status.toLowerCase().replace("_", " ")}`, detail: `${d.amount} ${d.symbol} on ${d.network}`, at: d.firstSeenAt, href: "/admin/desk#deposits", action: "Investigate" as const })),
    ...approvals.map((a) => ({ id: a.id, kind: "approval" as const, title: "Change awaiting approval", detail: a.summary, at: a.requestedAt, href: "/admin/desk#approvals", action: "Review" as const })),
    ...crypto.map((o) => ({ id: o.id, kind: "crypto" as const, title: `Crypto order ${o.reference}`, detail: `${o.amountCrypto} ${o.symbol} · ${who(o.user)}`, at: o.createdAt, href: "/admin/desk#crypto", action: "Review" as const })),
    ...gift.map((o) => ({ id: o.id, kind: "gift" as const, title: `Gift card ${o.reference}`, detail: `$${o.faceValueUsd} ${o.brand} · ${who(o.user)}`, at: o.createdAt, href: "/admin/desk#gift", action: "Review" as const })),
    ...withdrawals.map((w) => ({ id: w.id, kind: "withdrawal" as const, title: `Withdrawal ${w.reference}`, detail: who(w.user), at: w.createdAt, href: "/admin/desk#withdrawals", action: "Review" as const })),
    ...kyc.map((k) => ({ id: k.id, kind: "kyc" as const, title: "KYC review", detail: who(k.user), at: k.submittedAt ?? k.updatedAt, href: "/admin/desk#kyc", action: "Review" as const })),
  ];
  // Risks first, then the oldest work.
  const weight = (i: PendingItem) => (i.action === "Investigate" ? 0 : 1);
  items.sort((a, b) => weight(a) - weight(b) || a.at.getTime() - b.at.getTime());
  return { total: counts.reduce((s, c) => s + c, 0), items: items.slice(0, limit) };
}

/**
 * The id of every piece of waiting work, in the same `${kind}-${id}` form as the bell's items, so
 * the bell can count what this staff member has not seen yet (not just the few it lists).
 * Capped per queue; a queue that long is a problem the desk will notice anyway.
 */
export async function pendingWorkIds(cap = 500): Promise<string[]> {
  const id = { select: { id: true }, take: cap } as const;
  const [fraud, deposits, approvals, crypto, gift, withdrawals, kyc] = await Promise.all([
    prisma.giftCardOrder.findMany({ where: { fraudFlag: true, status: { in: ["UNDER_REVIEW", "APPROVED"] } }, ...id }),
    prisma.blockchainDeposit.findMany({ where: { status: { in: [...DEPOSIT_EXCEPTIONS] } }, ...id }),
    prisma.approvalRequest.findMany({ where: { status: "PENDING", expiresAt: { gt: new Date() } }, ...id }),
    prisma.cryptoOrder.findMany({ where: { status: "UNDER_REVIEW" }, ...id }),
    prisma.giftCardOrder.findMany({ where: { status: "UNDER_REVIEW", fraudFlag: false }, ...id }),
    prisma.withdrawal.findMany({ where: { status: "PENDING" }, ...id }),
    prisma.kycProfile.findMany({ where: { status: "PENDING" }, ...id }),
  ]);
  const tag = (kind: PendingItem["kind"], rows: { id: string }[]) => rows.map((r) => `${kind}-${r.id}`);
  return [
    ...tag("fraud", fraud),
    ...tag("deposit", deposits),
    ...tag("approval", approvals),
    ...tag("crypto", crypto),
    ...tag("gift", gift),
    ...tag("withdrawal", withdrawals),
    ...tag("kyc", kyc),
  ];
}

/** Live checks of what the platform depends on. Nothing here is a stored or assumed figure. */
export async function systemStatus(): Promise<{ checks: StatusCheck[]; dbMs: number | null; serverUpSeconds: number }> {
  let dbOk = true;
  let dbMs: number | null = null;
  try {
    // The first query may have to open a pooled connection; time the second, a real round trip.
    await prisma.$queryRaw`SELECT 1`;
    const started = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    dbMs = Math.max(1, Math.round(performance.now() - started));
  } catch {
    dbOk = false;
  }
  const latestRate = await prisma.rate.findFirst({ where: { kind: "CRYPTO", isActive: true }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }).catch(() => null);
  const rateAgeH = latestRate ? (Date.now() - latestRate.updatedAt.getTime()) / 3_600_000 : null;
  const deposit = activeDepositProvider();
  const checks: StatusCheck[] = [
    { name: "Database", ok: dbOk, detail: dbOk ? `Answering in ${dbMs} ms` : "Not answering" },
    {
      name: "Payment provider (Paystack)",
      ok: paystackConfigured(),
      detail: paystackConfigured() ? "Connected" : "Not configured: card payments and transfers are off",
    },
    {
      name: "Blockchain deposits",
      ok: !!deposit && deposit.name !== "simulated",
      detail: deposit ? (deposit.name === "simulated" ? "Simulated (testing only)" : `Watching via ${deposit.name}`) : "Off: customers paste transaction hashes",
    },
    {
      name: "Crypto rates",
      ok: rateAgeH !== null && rateAgeH < 6,
      detail: rateAgeH === null ? "No active rates" : rateAgeH < 1 ? "Updated within the hour" : `Last updated ${Math.round(rateAgeH)}h ago`,
    },
    {
      name: "Email notifications",
      ok: !!process.env.RESEND_API_KEY?.trim(),
      detail: process.env.RESEND_API_KEY?.trim() ? "Sending" : "Not configured",
    },
  ];
  return { checks, dbMs, serverUpSeconds: Math.round(process.uptime()) };
}

/** Totals used by the sidebar and the bell. */
export async function pendingCount(): Promise<number> {
  return (await pendingWork(0)).total;
}
