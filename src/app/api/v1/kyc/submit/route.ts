import { submitKyc } from "@/lib/services/kyc";
import { authed, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** POST /api/v1/kyc/submit  { bvn, nin, bankCode, accountNumber } -> { status } */
export const POST = authed(async ({ user, body, ctx }) => fromResult(await submitKyc(user, body, ctx)));
