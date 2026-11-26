import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import {
  assignTicket,
  createTicket,
  customerReply,
  getMyTicket,
  getTicketForStaff,
  listMyTickets,
  listTicketsForStaff,
  setTicketStatus,
  staffReply,
} from "@/lib/services/support";
import { pendingWorkIds } from "@/lib/services/admin-overview";
import * as tickets from "@/app/api/v1/support/tickets/route";
import * as ticket from "@/app/api/v1/support/tickets/[id]/route";
import * as messages from "@/app/api/v1/support/tickets/[id]/messages/route";
import type { StaffRole } from "@/generated/prisma/enums";
import { makeAdmin, makeCustomer, makeSellOrder, settle } from "../helpers/fixtures";

const ctx = { ip: "127.0.0.1" };
const staff = async (staffRole: StaffRole) => {
  const a = await makeAdmin();
  await prisma.user.update({ where: { id: a.id }, data: { staffRole } });
  return { id: a.id, role: "ADMIN" as const, staffRole };
};
const ask = { category: "WITHDRAWAL", subject: "Withdrawal not received", message: "It says paid but my bank shows nothing yet." };

describe("support tickets", () => {
  it("run from a customer's question to a staff answer and back", async () => {
    const customer = await makeCustomer();
    const agent = await staff("CUSTOMER_SUPPORT");

    const opened = await createTicket(customer, ask, ctx);
    expect(opened.ok).toBe(true);
    const id = opened.ok ? opened.data.id : "";
    expect(opened.ok && opened.data.reference).toMatch(/^NXT-/);
    expect(opened.ok && opened.data.status).toBe("OPEN");

    // It shows up for staff, in the queue and in the bell.
    expect((await listTicketsForStaff({})).tickets.some((t) => t.id === id)).toBe(true);
    expect(await pendingWorkIds()).toContain(`support-${id}`);

    expect((await staffReply(agent, id, { message: "Checking with the bank now. Can you send a screenshot?" })).ok).toBe(true);
    let t = await getMyTicket(customer, id);
    expect(t?.status).toBe("AWAITING_CUSTOMER");
    // The customer sees "Nexora support", never the staff member's name.
    expect(t?.messages?.at(-1)).toMatchObject({ fromStaff: true, author: "Nexora support" });
    expect((await getTicketForStaff(id))?.assignedToId).toBe(agent.id);
    expect(await prisma.notification.count({ where: { userId: customer.id, href: `/support/${id}` } })).toBe(1);

    // The customer answers: back to the staff queue.
    expect((await customerReply(customer, id, { message: "Here it is, thanks" }, ctx)).ok).toBe(true);
    expect((await getMyTicket(customer, id))?.status).toBe("OPEN");

    // Resolved with a reply; a later customer message reopens it.
    expect((await staffReply(agent, id, { message: "Found it, it has landed now.", resolve: "on" })).ok).toBe(true);
    expect((await getMyTicket(customer, id))?.status).toBe("RESOLVED");
    expect((await customerReply(customer, id, { message: "Actually only half arrived" }, ctx)).ok).toBe(true);
    t = await getMyTicket(customer, id);
    expect(t?.status).toBe("OPEN");
    expect(t?.messages).toHaveLength(5);

    // Closed is final for everyone.
    expect((await setTicketStatus(agent, id, { status: "CLOSED" })).ok).toBe(true);
    expect((await customerReply(customer, id, { message: "Hello?" }, ctx))).toMatchObject({ ok: false, status: 409 });
    expect((await staffReply(agent, id, { message: "Late reply" }))).toMatchObject({ ok: false, status: 409 });
    expect((await setTicketStatus(agent, id, { status: "OPEN" }))).toMatchObject({ ok: false, status: 409 });

    const audited = await prisma.auditLog.findMany({ where: { meta: { contains: opened.ok ? opened.data.reference : "-" } }, select: { action: true } });
    expect(audited.map((a) => a.action)).toEqual(
      expect.arrayContaining(["support.ticket_create", "admin.support_reply", "support.customer_reply", "admin.support_status"]),
    );
    await settle();
  });

  it("only links a ticket to the customer's own transaction", async () => {
    const owner = await makeCustomer();
    const stranger = await makeCustomer();
    const order = await makeSellOrder(owner.id);

    const mine = await createTicket(owner, { ...ask, category: "TRADE", reference: order.reference.toLowerCase() }, ctx);
    expect(mine.ok && mine.data.orderReference).toBe(order.reference);

    const theirs = await createTicket(stranger, { ...ask, category: "TRADE", reference: order.reference }, ctx);
    expect(theirs).toMatchObject({ ok: false, status: 422 });
  });

  it("keeps customers out of each other's tickets", async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    const opened = await createTicket(a, ask, ctx);
    const id = opened.ok ? opened.data.id : "";

    expect(await getMyTicket(b, id)).toBeNull();
    expect((await customerReply(b, id, { message: "Not my ticket" }, ctx))).toMatchObject({ ok: false, status: 404 });
    expect((await listMyTickets(b)).some((t) => t.id === id)).toBe(false);
  });

  it("lets only support roles answer or change tickets", async () => {
    const customer = await makeCustomer();
    const trader = await staff("TRADING_OFFICER");
    const opened = await createTicket(customer, ask, ctx);
    const id = opened.ok ? opened.data.id : "";

    expect(await staffReply(trader, id, { message: "Hello" })).toMatchObject({ ok: false, status: 403 });
    expect(await setTicketStatus(trader, id, { status: "RESOLVED" })).toMatchObject({ ok: false, status: 403 });
    expect(await assignTicket(trader, id, true)).toMatchObject({ ok: false, status: 403 });

    const ops = await staff("OPERATIONS_MANAGER");
    expect((await assignTicket(ops, id, true)).ok).toBe(true);
    expect((await getTicketForStaff(id))?.assignedToId).toBe(ops.id);
  });

  it("caps how many tickets a customer can have open at once", async () => {
    const customer = await makeCustomer();
    for (let i = 0; i < 5; i++) expect((await createTicket(customer, { ...ask, subject: `Ticket number ${i}` }, ctx)).ok).toBe(true);
    expect(await createTicket(customer, ask, ctx)).toMatchObject({ ok: false });
    await settle();
  });
});

type Handler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;
async function call<P>(handler: Handler<P>, opts: { method?: string; token: string; body?: unknown; key?: string; params?: P }) {
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${opts.token}`, "x-forwarded-for": "10.8.0.1" };
  if (opts.key) headers["idempotency-key"] = opts.key;
  const res = await handler(
    new Request("http://api.test/api/v1/support", { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
    { params: Promise.resolve(opts.params ?? ({} as P)) },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

describe("support API (/api/v1/support/tickets)", () => {
  it("opens, lists, reads and replies to a ticket for the signed-in customer", async () => {
    const customer = await makeCustomer();
    const token = await createSession({ ...customer, fullName: "Ada Test", phone: "0", role: "USER" }, { setCookie: false });

    const noKey = await call(tickets.POST, { method: "POST", token, body: ask });
    expect(noKey.status).toBe(400); // creating needs an Idempotency-Key

    const created = await call(tickets.POST, { method: "POST", token, body: ask, key: `t-${customer.id}` });
    expect(created.status).toBe(201);
    const id = created.json.data.id as string;
    expect(created.json.data.messages).toHaveLength(1);

    // Same key again: the same ticket, not a second one.
    const again = await call(tickets.POST, { method: "POST", token, body: ask, key: `t-${customer.id}` });
    expect(again.json.data.id).toBe(id);
    expect(await prisma.supportTicket.count({ where: { userId: customer.id } })).toBe(1);

    const list = await call(tickets.GET, { token });
    expect(list.json.data.map((t: { id: string }) => t.id)).toEqual([id]);

    const one = await call(ticket.GET, { token, params: { id } });
    expect(one.json.data.subject).toBe(ask.subject);

    const reply = await call(messages.POST, { method: "POST", token, body: { message: "Any update?" }, key: `r-${customer.id}`, params: { id } });
    expect(reply.status).toBe(201);
    expect(reply.json.data.messages).toHaveLength(2);

    const missing = await call(ticket.GET, { token, params: { id: "nope" } });
    expect(missing.status).toBe(404);
    await settle();
  });
});
