import { getReferralOverview } from "@/lib/services/wallet";
import { authed, data } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/referrals  Referral code, bonus terms, people referred and what has been earned. */
export const GET = authed(async ({ user }) => data(await getReferralOverview(user.id)));
