import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { reconcilePendingPayments } from "@/lib/services/payments";
import { reconcileWithdrawalPayouts } from "@/lib/services/wallet";
import { reconcileOrderPayouts } from "@/lib/services/desk";
import { purgeIdempotencyKeys } from "@/lib/api/idempotency";
import { purgeUnusedQuotes } from "@/lib/services/quotes";
import { checkLedgerIntegrity } from "@/lib/services/ledger";
import { notifyAdmin } from "@/lib/notify";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/reconcile-payments
 * Header: Authorization: Bearer <CRON_SECRET>
 * Run every 1-5 minutes. Settles payments whose webhook was missed or whose
 * customer closed the browser, expires checkouts that were never paid, and
 * verifies bank payouts that Paystack never confirmed to us.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (!safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await reconcilePendingPayments();
  if (result.settled || result.abandoned) log.info("cron: payments reconciled", result);

  // Outgoing transfers too: a lost Paystack response or a missed transfer webhook is
  // settled here by asking Paystack, never by guessing.
  const [withdrawals, orders] = await Promise.all([reconcileWithdrawalPayouts(), reconcileOrderPayouts()]);
  const payouts = { checked: withdrawals.checked + orders.checked, resolved: withdrawals.resolved + orders.resolved };
  if (payouts.resolved) log.info("cron: payouts reconciled", payouts);

  // Housekeeping: idempotency keys are only useful for a day.
  await purgeIdempotencyKeys();
  await purgeUnusedQuotes();

  // The ledger must reconcile on every run. A finding is never fixed automatically: a person is alerted.
  const ledger = await checkLedgerIntegrity();
  if (!ledger.ok) {
    log.error("cron: ledger does not reconcile", { problems: ledger.problems });
    void notifyAdmin("ledger.integrity_failed", { problems: ledger.problems });
  }

  return NextResponse.json({
    ok: true,
    ...result,
    payouts,
    ledger: { ok: ledger.ok, problems: ledger.problems },
    at: new Date().toISOString(),
  });
}
