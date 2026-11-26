import { customerReply } from "@/lib/services/support";
import { authed, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/support/tickets/:id/messages  (Idempotency-Key required)  { message } -> the ticket
 * Replying puts the ticket back in the support queue (and reopens it if it was resolved).
 */
export const POST = authed<{ id: string }>(
  async ({ user, params, body, ctx }) => fromResult(await customerReply(user, params.id, body, ctx), (t) => t, 201),
  { idempotent: true },
);
