import { paymentStatusFor } from "@/lib/services/payments";
import { authed, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/deposits/:reference  Payment status. While pending, this re-checks with the provider. */
export const GET = authed<{ reference: string }>(async ({ user, params }) =>
  fromResult(await paymentStatusFor(user, params.reference.slice(0, 80))),
);
