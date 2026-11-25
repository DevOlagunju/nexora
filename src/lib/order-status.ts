import type { OrderStatus } from "@/generated/prisma/enums";

/**
 * Desk order lifecycle. Re-saving the current status (to edit a note or payout ref)
 * is always allowed; anything else must follow these edges.
 *
 *   AWAITING_DEPOSIT -> UNDER_REVIEW -> APPROVED -> PAYOUT_SENT -> COMPLETED
 *            \               \            \             |
 *             +-> CANCELLED   +-> REJECTED <+    (failed payout -> APPROVED)
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["AWAITING_DEPOSIT", "UNDER_REVIEW", "CANCELLED"],
  AWAITING_DEPOSIT: ["UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED"],
  // Buy orders: desk confirms NGN, sends crypto, can close straight to COMPLETED.
  UNDER_REVIEW: ["AWAITING_DEPOSIT", "APPROVED", "PAYOUT_SENT", "COMPLETED", "REJECTED", "CANCELLED"],
  APPROVED: ["UNDER_REVIEW", "PAYOUT_SENT", "COMPLETED", "REJECTED"],
  PAYOUT_SENT: ["COMPLETED", "APPROVED"],
  COMPLETED: [],
  // Reopen a mistaken rejection for another look.
  REJECTED: ["UNDER_REVIEW"],
  CANCELLED: [],
};

export const TERMINAL_STATUSES: readonly OrderStatus[] = ["COMPLETED", "CANCELLED"];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedNextStatuses(from: OrderStatus): OrderStatus[] {
  return [from, ...ORDER_TRANSITIONS[from]];
}

/** Statuses the customer may still attach a TX hash / payment ref to. */
export const CUSTOMER_EDITABLE: readonly OrderStatus[] = ["AWAITING_DEPOSIT", "UNDER_REVIEW"];

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  AWAITING_DEPOSIT: "Awaiting deposit",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  PAYOUT_SENT: "Payout sent",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
