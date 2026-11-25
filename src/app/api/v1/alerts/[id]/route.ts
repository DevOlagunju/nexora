import { deleteRateAlert } from "@/lib/services/rate-alerts";
import { authed, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** DELETE /api/v1/alerts/:id */
export const DELETE = authed<{ id: string }>(async ({ user, params }) =>
  fromResult(await deleteRateAlert(user, { id: params.id }), () => ({ deleted: true })),
);
