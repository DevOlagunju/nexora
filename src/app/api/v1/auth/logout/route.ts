import { destroySession } from "@/lib/auth";
import { bearerToken, data, open } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/logout  Ends the session of the token (or web cookie) that made the call. */
export const POST = open(async ({ request }) => {
  await destroySession(bearerToken(request));
  return data({ signedOut: true });
});
