import { prisma } from "@/lib/db";

const hits = new Map<string, { count: number; resetAt: number }>();

/** Simple in-memory rate limit — swap for Redis in production multi-instance */
export function rateLimit(key: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || row.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (row.count >= limit) return false;
  row.count += 1;
  return true;
}

export async function writeAudit(
  action: string,
  opts?: { userId?: string; meta?: Record<string, unknown>; ip?: string },
) {
  await prisma.auditLog.create({
    data: {
      action,
      userId: opts?.userId,
      meta: opts?.meta ? JSON.stringify(opts.meta) : undefined,
      ipHash: opts?.ip
        ? (await import("@/lib/crypto")).sha256(opts.ip)
        : undefined,
    },
  });
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  AWAITING_DEPOSIT: "Awaiting deposit",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  PAYOUT_SENT: "Payout sent",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
