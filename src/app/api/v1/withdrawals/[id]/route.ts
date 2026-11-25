import { cancelWithdrawal } from "@/lib/services/wallet";
import { authed, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** DELETE /api/v1/withdrawals/:id  Cancels a withdrawal the desk has not started paying; the money returns to the wallet. */
export const DELETE = authed<{ id: string }>(async ({ user, params }) =>
  fromResult(await cancelWithdrawal(user, { id: params.id }), () => ({ cancelled: true })),
);
