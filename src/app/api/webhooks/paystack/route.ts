import { NextResponse } from "next/server";
import { verifyPaystackSignature } from "@/lib/paystack";
import { writeAudit } from "@/lib/security";
import { log } from "@/lib/log";
import { settleWithdrawalTransfer } from "@/lib/services/wallet";
import { settleOrderTransfer } from "@/lib/services/desk";
import { settlePayment } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

/**
 * Paystack webhook: confirms incoming payments instantly and closes the loop on Transfer payouts.
 *
 *  charge.success             Payment PENDING -> SUCCESS (re-verified via /transaction/verify, then
 *                             wallet credited / card-paid buy order funded). Idempotent.
 * Dashboard -> Settings -> API Keys & Webhooks -> https://<domain>/api/webhooks/paystack
 *
 *  transfer.success           PAYOUT_SENT -> COMPLETED
 *  transfer.failed / reversed PAYOUT_SENT -> APPROVED (+ desk alert, payout ref cleared)
 *
 *  Wallet withdrawals:        PROCESSING -> PAID, or -> FAILED with the amount refunded to the wallet
 *
 * A transfer is matched by its Paystack code, or by our own reference when the code was never
 * recorded (see src/lib/payout-rules.ts). Idempotent: only orders waiting on a transfer and
 * withdrawals in flight are moved, so retries are no-ops.
 */

type TransferEvent = {
  event: string;
  data?: { transfer_code?: string; reference?: string; reason?: string; status?: string; amount?: number };
};

export async function POST(request: Request) {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret) return NextResponse.json({ error: "Paystack not configured" }, { status: 503 });

  const raw = await request.text();
  if (!verifyPaystackSignature(raw, request.headers.get("x-paystack-signature"), secret)) {
    log.warn("paystack webhook: bad signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let evt: TransferEvent;
  try {
    evt = JSON.parse(raw) as TransferEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (evt.event === "charge.success") {
    const reference = evt.data?.reference;
    if (!reference) return NextResponse.json({ ok: true, ignored: true });
    // Never trust the webhook body for amounts: settlePayment re-verifies with Paystack.
    const settled = await settlePayment(reference, "webhook");
    if (!settled) {
      // A charge we didn't start (e.g. made in the Paystack dashboard). Record it for the desk.
      await writeAudit("paystack.charge_unmatched", { meta: { reference } });
      return NextResponse.json({ ok: true, matched: false });
    }
    return NextResponse.json({ ok: true, matched: true, status: settled.status });
  }

  const transferCode = evt.data?.transfer_code;
  if (!evt.event?.startsWith("transfer.") || !transferCode) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const success = evt.event === "transfer.success";
  const failed = evt.event === "transfer.failed" || evt.event === "transfer.reversed";
  if (!success && !failed) return NextResponse.json({ ok: true, ignored: true });

  // Our own transfer reference: lets us match a transfer whose code we never recorded
  // (response lost, or this webhook arriving before the payout request returned).
  const transferRef = evt.data?.reference;

  const withdrawal = await settleWithdrawalTransfer(transferCode, success, evt.data?.reason, transferRef);
  if (withdrawal) {
    await writeAudit(`paystack.${evt.event}`, {
      meta: { channel: "withdrawal", reference: withdrawal.reference, transferCode, applied: withdrawal.applied },
    });
    return NextResponse.json({ ok: true, matched: true, applied: withdrawal.applied });
  }

  const order = await settleOrderTransfer({
    transferCode,
    transferRef,
    success,
    reason: evt.data?.reason,
    event: evt.event,
  });
  if (!order) {
    log.warn("paystack webhook: no order for transfer", { transferCode, event: evt.event });
    await writeAudit("paystack.webhook_unmatched", { meta: { transferCode, transferRef, event: evt.event } });
    return NextResponse.json({ ok: true, matched: false });
  }

  await writeAudit(`paystack.${evt.event}`, {
    meta: { channel: order.channel, orderId: order.orderId, reference: order.reference, transferCode, applied: order.applied },
  });
  return NextResponse.json({ ok: true, matched: true, applied: order.applied });
}
