import { STATUS_LABEL } from "@/lib/order-status";

export type StatusTone = "pending" | "review" | "success" | "danger" | "muted";

const TONE_BY_STATUS: Record<string, StatusTone> = {
  DRAFT: "muted",
  AWAITING_DEPOSIT: "pending",
  UNDER_REVIEW: "review",
  APPROVED: "review",
  PAYOUT_SENT: "pending",
  COMPLETED: "success",
  REJECTED: "danger",
  CANCELLED: "muted",
  UNVERIFIED: "muted",
  PENDING: "review",
  // Withdrawals
  PROCESSING: "pending",
  PAID: "success",
  FAILED: "danger",
  // Card / transfer payments
  SUCCESS: "success",
  ABANDONED: "muted",
  // KYC
  VERIFIED: "success",
};

const EXTRA_LABEL: Record<string, string> = {
  PROCESSING: "Processing",
  PAID: "Paid",
  FAILED: "Failed",
  PENDING: "Pending",
  SUCCESS: "Completed",
  ABANDONED: "Abandoned",
  VERIFIED: "Verified",
  UNVERIFIED: "Unverified",
};

export function statusTone(status: string): StatusTone {
  return TONE_BY_STATUS[status] ?? "muted";
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? EXTRA_LABEL[status] ?? status.replace(/_/g, " ");
}

export function statusPillClass(status: string): string {
  return `status-pill status-${statusTone(status)}`;
}
