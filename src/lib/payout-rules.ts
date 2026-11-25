import type { TransferState } from "@/lib/paystack";

/**
 * Pure rules for bank payouts in flight. No I/O, unit tested.
 *
 * While a transfer is being sent, the row's payoutRef holds a lock ("pending:<adminId>:<ms>").
 * The lock is only ever cleared by a definite answer from Paystack, so a timeout can never
 * turn into a second payout or a refund of money that already left.
 */

export const PAYOUT_LOCK_PREFIX = "pending:";

/** How long Paystack may take to register a transfer we never got a response for. */
export const PAYOUT_NOT_FOUND_GRACE_MS = 15 * 60_000;

export function newPayoutLock(adminId: string, now = Date.now()) {
  return `${PAYOUT_LOCK_PREFIX}${adminId}:${now}`;
}

export function isPayoutLock(ref: string | null | undefined): boolean {
  return !!ref && ref.startsWith(PAYOUT_LOCK_PREFIX);
}

/** Age of a lock, or null when the value is not a lock or carries no timestamp. */
export function payoutLockAgeMs(ref: string | null | undefined, now = Date.now()): number | null {
  if (!ref || !isPayoutLock(ref)) return null;
  const at = Number(ref.slice(ref.lastIndexOf(":") + 1));
  return Number.isFinite(at) && at > 0 ? Math.max(0, now - at) : null;
}

export type PayoutVerdict =
  /** Money reached the bank. */
  | "paid"
  /** Paystack accepted the transfer and it is still moving. */
  | "in_flight"
  /** Paystack says the transfer failed or was reversed: nothing was paid. */
  | "failed"
  /** Paystack has no such transfer and enough time has passed: it was never sent, safe to retry. */
  | "never_sent"
  /** Not enough is known yet. Leave everything as it is. */
  | "wait";

export function payoutVerdict(input: { state: TransferState; payoutRef: string | null; now?: number }): PayoutVerdict {
  if (input.state === "success") return "paid";
  if (input.state === "pending") return "in_flight";
  if (input.state === "failed") return "failed";
  // not_found: only meaningful while we hold a lock, and only once Paystack has had time to register it.
  const age = payoutLockAgeMs(input.payoutRef, input.now);
  return age !== null && age >= PAYOUT_NOT_FOUND_GRACE_MS ? "never_sent" : "wait";
}
