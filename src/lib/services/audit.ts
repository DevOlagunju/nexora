import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { AUDIT_GROUPS, type AuditGroup } from "@/lib/audit-rules";

export const AUDIT_PAGE_SIZE = 50;

/**
 * One page of the audit trail, newest first. `q` matches the person's name or email, the action
 * code, or the stored details (so an order or withdrawal reference finds its events).
 * Read-only: the table is append-only in the database (see the audit_log_append_only migration).
 */
export async function listAuditLog(input: { group: AuditGroup; q: string; page: number }) {
  const g = AUDIT_GROUPS[input.group];
  const and: Prisma.AuditLogWhereInput[] = [];

  if (g.prefixes.length || g.actions.length) {
    and.push({
      OR: [
        ...g.prefixes.map((p) => ({ action: { startsWith: p } })),
        ...(g.actions.length ? [{ action: { in: [...g.actions] } }] : []),
      ],
    });
  }

  const q = input.q.trim().slice(0, 100);
  if (q) {
    const text = { contains: q, mode: "insensitive" as const };
    and.push({
      OR: [{ action: text }, { meta: text }, { user: { is: { email: text } } }, { user: { is: { fullName: text } } }],
    });
  }

  const where: Prisma.AuditLogWhereInput = and.length ? { AND: and } : {};
  // One extra row tells us whether an older page exists without a second count query.
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (input.page - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE + 1,
    include: { user: { select: { id: true, email: true, fullName: true, role: true } } },
  });

  return {
    rows: rows.slice(0, AUDIT_PAGE_SIZE),
    hasOlder: rows.length > AUDIT_PAGE_SIZE,
    page: input.page,
  };
}

export type AuditPage = Awaited<ReturnType<typeof listAuditLog>>;
