import { createSession } from "@/lib/auth";
import { registerUser } from "@/lib/services/accounts";
import { data, fail, open } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/register  { fullName, email, phone, password, referralCode? } -> { user, token } */
export const POST = open(async ({ body, ctx }) => {
  const result = await registerUser(body, ctx);
  if (!result.ok) return fail(result.status, result.error);
  const token = await createSession(result.data, { ...ctx, setCookie: false });
  return data({ user: result.data, token }, { status: 201 });
});
