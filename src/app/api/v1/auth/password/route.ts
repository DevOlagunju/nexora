import { changePassword } from "@/lib/services/accounts";
import { authed, bearerToken, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** PUT /api/v1/auth/password  { currentPassword, newPassword, confirmPassword } -> { token }. Other sessions are revoked. */
export const PUT = authed(async ({ request, user, body, ctx }) =>
  fromResult(await changePassword(user, body, { ...ctx, setCookie: !bearerToken(request) })),
);
