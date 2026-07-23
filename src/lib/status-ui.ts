import { STATUS_LABEL } from "@/lib/security";

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
};

export function statusTone(status: string): StatusTone {
  return TONE_BY_STATUS[status] ?? "muted";
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

export function statusPillClass(status: string): string {
  return `status-pill status-${statusTone(status)}`;
}
