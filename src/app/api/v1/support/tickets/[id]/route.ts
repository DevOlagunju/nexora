import { getMyTicket } from "@/lib/services/support";
import { authed, data, fail } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/support/tickets/:id  One of the customer's tickets with the whole conversation. */
export const GET = authed<{ id: string }>(async ({ user, params }) => {
  const ticket = await getMyTicket(user, params.id);
  return ticket ? data(ticket) : fail(404, "Ticket not found.");
});
