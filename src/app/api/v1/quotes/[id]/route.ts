import { getQuote } from "@/lib/services/quotes";
import { authed, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/quotes/:id  The quote with its current status: OPEN, ACCEPTED or EXPIRED. */
export const GET = authed<{ id: string }>(async ({ user, params }) => fromResult(await getQuote(user, params.id)));
