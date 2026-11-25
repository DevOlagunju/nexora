import { destroyAllSessionsForUser } from "@/lib/auth";
import { writeAudit } from "@/lib/security";
import { authed, bearerToken, data } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** DELETE /api/v1/auth/sessions  Signs the user out everywhere. */
export const DELETE = authed(async ({ request, user, ctx }) => {
  await destroyAllSessionsForUser(user.id, { clearCookie: !bearerToken(request) });
  await writeAudit("user.logout_all", { userId: user.id, ip: ctx.ip });
  return data({ signedOut: true });
});
