import { listBanks } from "@/lib/banks";
import { authed, data } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/banks  Nigerian banks for the KYC bank picker. "live" is false when the fallback list is served. */
export const GET = authed(async () => data(await listBanks()));
