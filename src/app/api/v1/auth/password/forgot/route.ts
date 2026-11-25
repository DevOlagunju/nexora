import { startPasswordReset } from "@/lib/services/accounts";
import { fromResult, open } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/password/forgot  { email }  Answers the same way whether or not the email exists. */
export const POST = open(async ({ body, ctx }) => fromResult(await startPasswordReset(body, ctx)));
