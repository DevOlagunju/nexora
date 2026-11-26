import { CATEGORY_LABEL } from "@/lib/support-rules";
import { authed, data } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/support/categories  What a ticket can be about, with display labels. */
export const GET = authed(async () => data(Object.entries(CATEGORY_LABEL).map(([code, label]) => ({ code, label }))));
