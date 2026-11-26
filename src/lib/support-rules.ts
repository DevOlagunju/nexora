import { z } from "zod";
import type { SupportCategory, SupportStatus } from "@/generated/prisma/enums";

/**
 * Support tickets: categories, statuses and who may move a ticket where. Pure and unit tested
 * (tests/support-rules.test.ts). The service is src/lib/services/support.ts.
 */

export const CATEGORY_LABEL: Record<SupportCategory, string> = {
  TRADE: "Crypto trade",
  GIFT_CARD: "Gift card",
  DEPOSIT: "Adding money / deposit",
  WITHDRAWAL: "Withdrawal",
  ACCOUNT: "Account and security",
  KYC: "Verification (KYC)",
  OTHER: "Something else",
};

export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = {
  OPEN: "Waiting for support",
  AWAITING_CUSTOMER: "Waiting for your reply",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

/** What staff see: the same statuses, worded for the desk. */
export const SUPPORT_STATUS_LABEL_STAFF: Record<SupportStatus, string> = {
  OPEN: "Needs a reply",
  AWAITING_CUSTOMER: "Waiting on customer",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

/** Status pill colours on the admin desk. */
export const SUPPORT_STATUS_STYLE: Record<SupportStatus, string> = {
  OPEN: "bg-[#fff4d6] text-[#7a5200]",
  AWAITING_CUSTOMER: "bg-[#e7efff] text-[#2563eb]",
  RESOLVED: "bg-accent-soft text-accent-deep",
  CLOSED: "bg-[#eef1f4] text-[#3d4a57]",
};

/** A customer may have this many tickets that are not resolved or closed at once. */
export const MAX_OPEN_TICKETS = 5;

const categories = Object.keys(CATEGORY_LABEL) as [SupportCategory, ...SupportCategory[]];

export const newTicketSchema = z.object({
  category: z.enum(categories, { error: "Choose what this is about." }),
  subject: z.string().trim().min(4, "Give it a short title (at least 4 characters).").max(120),
  message: z.string().trim().min(10, "Tell us what happened (at least 10 characters).").max(2_000),
  /** Optional: the order, withdrawal or deposit reference this is about. */
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .max(40)
    .regex(/^[A-Z0-9-]*$/, "That doesn't look like a Nexora reference.")
    .optional()
    .transform((v) => v || undefined),
});

export const replySchema = z.object({
  message: z.string().trim().min(2, "Write a message.").max(2_000),
});

/** Where staff may move a ticket from each status. Closed is final. */
const STAFF_MOVES: Record<SupportStatus, readonly SupportStatus[]> = {
  OPEN: ["AWAITING_CUSTOMER", "RESOLVED", "CLOSED"],
  AWAITING_CUSTOMER: ["OPEN", "RESOLVED", "CLOSED"],
  RESOLVED: ["OPEN", "CLOSED"],
  CLOSED: [],
};

export function staffCanMove(from: SupportStatus, to: SupportStatus): boolean {
  return STAFF_MOVES[from].includes(to);
}

export function staffMovesFrom(from: SupportStatus): readonly SupportStatus[] {
  return STAFF_MOVES[from];
}

/** A customer's message puts the ticket back in the staff queue; a closed ticket takes no more. */
export function statusAfterCustomerReply(current: SupportStatus): SupportStatus | null {
  return current === "CLOSED" ? null : "OPEN";
}

/** Still being worked on (counts towards MAX_OPEN_TICKETS). */
export function isActive(status: SupportStatus): boolean {
  return status === "OPEN" || status === "AWAITING_CUSTOMER";
}
