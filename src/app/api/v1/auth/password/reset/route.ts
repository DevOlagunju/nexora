import { finishPasswordReset } from "@/lib/services/accounts";
import { fromResult, open } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/password/reset  { token, newPassword, confirmPassword } */
export const POST = open(async ({ body, ctx }) => fromResult(await finishPasswordReset(body, ctx), () => ({ reset: true })));
