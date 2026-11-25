import { createRateAlert, listRateAlerts } from "@/lib/services/rate-alerts";
import { authed, data, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/alerts  The user's rate alerts. */
export const GET = authed(async ({ user }) => data(await listRateAlerts(user.id)));

/** POST /api/v1/alerts  { rateId, side, direction, targetNgn } */
export const POST = authed(async ({ user, body }) => fromResult(await createRateAlert(user, body), () => ({ created: true }), 201));
