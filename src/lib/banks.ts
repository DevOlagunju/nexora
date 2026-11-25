import "server-only";
import { paystackConfigured, paystackFetch } from "@/lib/paystack";
import { errorMessage, log } from "@/lib/log";
import { FALLBACK_BANKS, type Bank } from "@/lib/bank-rules";

/**
 * Nigerian bank list + account-name lookup (Paystack Verification API).
 * Docs: https://paystack.com/docs/identity-verification/verify-account-number/
 */

const LIST_TTL_MS = 12 * 60 * 60_000;
let cache: { at: number; banks: Bank[] } | null = null;

export async function listBanks(): Promise<{ banks: Bank[]; live: boolean }> {
  if (!paystackConfigured()) return { banks: FALLBACK_BANKS, live: false };
  if (cache && Date.now() - cache.at < LIST_TTL_MS) return { banks: cache.banks, live: true };
  try {
    const rows = await paystackFetch<Array<{ name: string; code: string; active?: boolean; is_deleted?: boolean }>>(
      "/bank?country=nigeria&currency=NGN&perPage=300",
    );
    const seen = new Set<string>();
    const banks = rows
      .filter((b) => b.active !== false && !b.is_deleted && b.code && !seen.has(b.code) && seen.add(b.code))
      .map((b) => ({ name: b.name.trim(), code: b.code }))
      .sort((a, b) => a.name.localeCompare(b.name));
    cache = { at: Date.now(), banks };
    return { banks, live: true };
  } catch (err) {
    log.warn("banks: list failed, using fallback", { error: errorMessage(err) });
    return { banks: FALLBACK_BANKS, live: false };
  }
}

export async function bankByCode(code: string): Promise<Bank | null> {
  const { banks } = await listBanks();
  return banks.find((b) => b.code === code) ?? FALLBACK_BANKS.find((b) => b.code === code) ?? null;
}

export type ResolveResult =
  | { ok: true; accountName: string; mode: "live" | "test" }
  | { ok: false; error: string };

/**
 * Look up the name on a NUBAN account. Without Paystack keys (local dev only) returns a
 * clearly-labelled test name so the flow can be exercised; production never does this.
 */
export async function resolveAccountName(
  accountNumber: string,
  bankCode: string,
  testName: string,
): Promise<ResolveResult> {
  if (!paystackConfigured()) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "Account lookup is unavailable right now. Enter your account name as on your bank app." };
    }
    return { ok: true, accountName: testName.toUpperCase(), mode: "test" };
  }
  try {
    const data = await paystackFetch<{ account_name: string; account_number: string }>(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
    if (!data.account_name) return { ok: false, error: "We couldn't find that account. Check the number and bank." };
    return { ok: true, accountName: data.account_name.trim(), mode: "live" };
  } catch (err) {
    const msg = errorMessage(err);
    log.warn("banks: resolve failed", { bankCode, error: msg });
    return {
      ok: false,
      error: /could not resolve|invalid|not found|unknown/i.test(msg)
        ? "We couldn't find that account. Check the number and bank."
        : "Bank lookup is busy. Try again in a moment.",
    };
  }
}
