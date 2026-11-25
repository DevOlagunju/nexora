import { lookupBankAccount } from "@/lib/services/kyc";
import { authed, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** POST /api/v1/banks/resolve  { bankCode, accountNumber } -> { accountName, bankName, nameMatch, mode } */
export const POST = authed(async ({ user, body }) => fromResult(await lookupBankAccount(user, body)));
