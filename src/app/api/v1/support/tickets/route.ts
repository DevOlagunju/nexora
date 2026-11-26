import { createTicket, listMyTickets } from "@/lib/services/support";
import { authed, data, fromResult, pageSize } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/support/tickets?limit=  The customer's tickets, most recently updated first. */
export const GET = authed(async ({ user, query }) => data(await listMyTickets(user, pageSize(query))));

/**
 * POST /api/v1/support/tickets  (Idempotency-Key required)
 *   { category, subject, message, reference? } -> the new ticket with its first message
 * `reference` is optional and must be one of the customer's own orders, withdrawals or top-ups.
 */
export const POST = authed(async ({ user, body, ctx }) => fromResult(await createTicket(user, body, ctx), (t) => t, 201), {
  idempotent: true,
});
