import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { orderReference } from "@/lib/crypto";
import { rateLimit, writeAudit } from "@/lib/security";
import { notifyAdmin } from "@/lib/notify";
import { can } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth";
import type { SupportStatus } from "@/generated/prisma/enums";
import { pushNotification } from "@/lib/services/notifications";
import { fail, ok, TOO_MANY, type ServiceResult } from "@/lib/services/result";
import {
  isActive,
  MAX_OPEN_TICKETS,
  newTicketSchema,
  replySchema,
  staffCanMove,
  statusAfterCustomerReply,
  SUPPORT_STATUS_LABEL,
} from "@/lib/support-rules";

/**
 * In-app support: a customer opens a ticket (optionally about one of their own transactions), and
 * customer and staff write back and forth until staff resolve or close it. Every step is audited.
 * Staff need `support.manage` to reply or change a ticket; any staff member can read the queue.
 */

type Customer = { id: string };
type Staff = Pick<SessionUser, "id" | "role" | "staffRole">;
type Ctx = { ip: string };

/** What a customer sees of a ticket. Staff are shown as "Nexora support", never by name. */
function customerView(t: {
  id: string;
  reference: string;
  category: string;
  subject: string;
  status: SupportStatus;
  orderReference: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages?: { id: string; fromStaff: boolean; body: string; createdAt: Date }[];
}) {
  return {
    id: t.id,
    reference: t.reference,
    category: t.category,
    subject: t.subject,
    status: t.status,
    statusLabel: SUPPORT_STATUS_LABEL[t.status],
    orderReference: t.orderReference,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    ...(t.messages
      ? { messages: t.messages.map((m) => ({ id: m.id, fromStaff: m.fromStaff, author: m.fromStaff ? "Nexora support" : "You", body: m.body, createdAt: m.createdAt })) }
      : {}),
  };
}

export type CustomerTicket = ReturnType<typeof customerView>;

/** Is this reference one of the customer's own orders, withdrawals or top-ups? */
async function ownsReference(userId: string, reference: string): Promise<boolean> {
  const where = { reference, userId };
  const [crypto, gift, withdrawal, payment] = await Promise.all([
    prisma.cryptoOrder.count({ where }),
    prisma.giftCardOrder.count({ where }),
    prisma.withdrawal.count({ where }),
    prisma.payment.count({ where }),
  ]);
  return crypto + gift + withdrawal + payment > 0;
}

// ---------------------------------------------------------------- customer

export async function createTicket(user: Customer, input: unknown, ctx: Ctx): Promise<ServiceResult<CustomerTicket>> {
  if (!(await rateLimit(`support:create:${user.id}`, 5, 60 * 60_000))) return TOO_MANY("new tickets");
  const parsed = newTicketSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const d = parsed.data;

  if (d.reference && !(await ownsReference(user.id, d.reference))) {
    return fail("We couldn't find that reference on your account. Check it, or leave it out.", 422);
  }
  const active = await prisma.supportTicket.count({ where: { userId: user.id, status: { in: ["OPEN", "AWAITING_CUSTOMER"] } } });
  if (active >= MAX_OPEN_TICKETS) {
    return fail(`You already have ${active} open tickets. Reply on one of those, or wait for them to be resolved.`, 429);
  }

  const ticket = await prisma.supportTicket.create({
    data: {
      reference: orderReference("NXT"),
      userId: user.id,
      category: d.category,
      subject: d.subject,
      orderReference: d.reference ?? null,
      messages: { create: { authorId: user.id, fromStaff: false, body: d.message } },
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  await writeAudit("support.ticket_create", {
    userId: user.id,
    ip: ctx.ip,
    meta: { reference: ticket.reference, category: d.category, orderReference: d.reference ?? null },
  });
  void notifyAdmin("support.ticket_created", { reference: ticket.reference, category: d.category, userId: user.id });
  return ok(customerView(ticket), `Ticket ${ticket.reference} opened. We'll reply here.`);
}

export async function listMyTickets(user: Customer, take = 20): Promise<CustomerTicket[]> {
  const rows = await prisma.supportTicket.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(take, 1), 100),
  });
  return rows.map((t) => customerView(t));
}

export async function getMyTicket(user: Customer, id: string): Promise<CustomerTicket | null> {
  const t = await prisma.supportTicket.findFirst({
    where: { id, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return t ? customerView(t) : null;
}

export async function customerReply(user: Customer, id: string, input: unknown, ctx: Ctx): Promise<ServiceResult<CustomerTicket>> {
  if (!(await rateLimit(`support:reply:${user.id}`, 20, 10 * 60_000))) return TOO_MANY("messages");
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const t = await prisma.supportTicket.findFirst({ where: { id, userId: user.id }, select: { id: true, reference: true, status: true } });
  if (!t) return fail("Ticket not found.", 404);
  const next = statusAfterCustomerReply(t.status);
  if (!next) return fail("This ticket is closed. Open a new one if you still need help.", 409);

  await prisma.$transaction([
    prisma.supportMessage.create({ data: { ticketId: t.id, authorId: user.id, fromStaff: false, body: parsed.data.message } }),
    prisma.supportTicket.update({ where: { id: t.id }, data: { status: next, lastCustomerAt: new Date(), resolvedAt: null } }),
  ]);
  await writeAudit("support.customer_reply", { userId: user.id, ip: ctx.ip, meta: { reference: t.reference, reopened: t.status === "RESOLVED" } });
  return ok((await getMyTicket(user, t.id))!, "Message sent.");
}

// ---------------------------------------------------------------- staff

const staffListSchema = z.object({
  status: z.enum(["active", "OPEN", "AWAITING_CUSTOMER", "RESOLVED", "CLOSED", "all"]).catch("active"),
  q: z.string().trim().max(100).catch(""),
});

/** The staff queue: oldest waiting first for active tickets, newest first otherwise. */
export async function listTicketsForStaff(input: { status?: unknown; q?: unknown }) {
  const { status, q } = staffListSchema.parse({ status: input.status ?? "active", q: input.q ?? "" });
  const statusWhere =
    status === "active" ? { status: { in: ["OPEN", "AWAITING_CUSTOMER"] as SupportStatus[] } } : status === "all" ? {} : { status };
  const text = q ? { contains: q, mode: "insensitive" as const } : undefined;
  const tickets = await prisma.supportTicket.findMany({
    where: {
      ...statusWhere,
      ...(text
        ? { OR: [{ reference: text }, { subject: text }, { orderReference: text }, { user: { is: { email: text } } }, { user: { is: { fullName: text } } }] }
        : {}),
    },
    orderBy: status === "active" ? [{ status: "asc" }, { lastCustomerAt: "asc" }] : [{ updatedAt: "desc" }],
    take: 100,
    include: {
      user: { select: { fullName: true, email: true } },
      assignedTo: { select: { fullName: true } },
      _count: { select: { messages: true } },
    },
  });
  const counts = await prisma.supportTicket.groupBy({ by: ["status"], _count: true });
  return { status, q, tickets, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<SupportStatus, number>> };
}

export async function getTicketForStaff(id: string) {
  return prisma.supportTicket.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true, kyc: { select: { status: true } } } },
      assignedTo: { select: { id: true, fullName: true } },
      messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { fullName: true } } } },
    },
  });
}

const staffReplySchema = replySchema.extend({
  /** Reply and mark resolved in one step. */
  resolve: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()),
});

export async function staffReply(staff: Staff, id: string, input: unknown): Promise<ServiceResult<null>> {
  if (!can(staff, "support.manage")) return fail("Your role cannot answer support tickets.", 403);
  const parsed = staffReplySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const t = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true, reference: true, userId: true, status: true, assignedToId: true } });
  if (!t) return fail("Ticket not found.", 404);
  if (t.status === "CLOSED") return fail("This ticket is closed. The customer can open a new one.", 409);
  const next: SupportStatus = parsed.data.resolve ? "RESOLVED" : "AWAITING_CUSTOMER";

  await prisma.$transaction([
    prisma.supportMessage.create({ data: { ticketId: t.id, authorId: staff.id, fromStaff: true, body: parsed.data.message } }),
    prisma.supportTicket.update({
      where: { id: t.id },
      data: { status: next, resolvedAt: next === "RESOLVED" ? new Date() : null, assignedToId: t.assignedToId ?? staff.id },
    }),
  ]);
  await writeAudit("admin.support_reply", { userId: staff.id, meta: { reference: t.reference, status: next } });
  void pushNotification(t.userId, {
    title: `Support replied: ${t.reference}`,
    body: parsed.data.message.slice(0, 160),
    href: `/support/${t.id}`,
  });
  return ok(null, next === "RESOLVED" ? "Reply sent and ticket resolved." : "Reply sent. Waiting for the customer.");
}

const moveSchema = z.object({
  status: z.enum(["OPEN", "AWAITING_CUSTOMER", "RESOLVED", "CLOSED"], { error: "Choose a status." }),
});

export async function setTicketStatus(staff: Staff, id: string, input: unknown): Promise<ServiceResult<null>> {
  if (!can(staff, "support.manage")) return fail("Your role cannot change support tickets.", 403);
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const to = parsed.data.status;

  const t = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true, reference: true, userId: true, status: true } });
  if (!t) return fail("Ticket not found.", 404);
  if (!staffCanMove(t.status, to)) return fail(`A ${t.status.toLowerCase().replace("_", " ")} ticket can't be moved to ${to.toLowerCase().replace("_", " ")}.`, 409);

  // Only move it if nobody changed it meanwhile.
  const { count } = await prisma.supportTicket.updateMany({
    where: { id: t.id, status: t.status },
    data: { status: to, resolvedAt: to === "RESOLVED" ? new Date() : to === "CLOSED" ? undefined : null },
  });
  if (count === 0) return fail("Someone changed this ticket a moment ago. Reload.", 409);

  await writeAudit("admin.support_status", { userId: staff.id, meta: { reference: t.reference, from: t.status, to } });
  if (to === "RESOLVED" || to === "CLOSED") {
    void pushNotification(t.userId, {
      title: `Ticket ${t.reference} ${to === "RESOLVED" ? "resolved" : "closed"}`,
      body: to === "RESOLVED" ? "Reply on the ticket if you still need help." : "Open a new ticket if you need more help.",
      href: `/support/${t.id}`,
    });
  }
  return ok(null, `Ticket moved to ${to.toLowerCase().replace("_", " ")}.`);
}

/** Take a ticket, or hand it back to the queue. */
export async function assignTicket(staff: Staff, id: string, take: boolean): Promise<ServiceResult<null>> {
  if (!can(staff, "support.manage")) return fail("Your role cannot change support tickets.", 403);
  const t = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true, reference: true, status: true } });
  if (!t) return fail("Ticket not found.", 404);
  if (!isActive(t.status)) return fail("Only open tickets can be assigned.", 409);
  await prisma.supportTicket.update({ where: { id }, data: { assignedToId: take ? staff.id : null } });
  await writeAudit("admin.support_assign", { userId: staff.id, meta: { reference: t.reference, assigned: take } });
  return ok(null, take ? "Ticket is yours." : "Ticket handed back to the queue.");
}
