import { setTransactionPin } from "@/lib/services/wallet";
import { authed, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** PUT /api/v1/users/me/pin  { password, pin, confirmPin }  Sets or changes the 4-digit transaction PIN. */
export const PUT = authed(async ({ user, body, ctx }) =>
  fromResult(await setTransactionPin(user, body, ctx), () => ({ pinSet: true })),
);
