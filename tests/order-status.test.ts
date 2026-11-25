import { describe, expect, it } from "vitest";
import { allowedNextStatuses, canTransition, ORDER_TRANSITIONS } from "@/lib/order-status";
import type { OrderStatus } from "@/generated/prisma/enums";

describe("order state machine", () => {
  it("allows the happy path for a crypto sell", () => {
    const path: OrderStatus[] = ["AWAITING_DEPOSIT", "UNDER_REVIEW", "APPROVED", "PAYOUT_SENT", "COMPLETED"];
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1], path[i])).toBe(true);
  });

  it("always allows re-saving the same status (note edits)", () => {
    for (const s of Object.keys(ORDER_TRANSITIONS) as OrderStatus[]) {
      expect(canTransition(s, s)).toBe(true);
    }
  });

  it("treats COMPLETED and CANCELLED as terminal", () => {
    expect(canTransition("COMPLETED", "AWAITING_DEPOSIT")).toBe(false);
    expect(canTransition("COMPLETED", "REJECTED")).toBe(false);
    expect(canTransition("CANCELLED", "UNDER_REVIEW")).toBe(false);
  });

  it("blocks paying out before funds are confirmed", () => {
    expect(canTransition("AWAITING_DEPOSIT", "PAYOUT_SENT")).toBe(false);
    expect(canTransition("AWAITING_DEPOSIT", "COMPLETED")).toBe(false);
  });

  it("lets a failed payout fall back to APPROVED", () => {
    expect(canTransition("PAYOUT_SENT", "APPROVED")).toBe(true);
    expect(canTransition("PAYOUT_SENT", "REJECTED")).toBe(false);
  });

  it("lists the current status first in dropdown options", () => {
    expect(allowedNextStatuses("APPROVED")[0]).toBe("APPROVED");
    expect(allowedNextStatuses("COMPLETED")).toEqual(["COMPLETED"]);
  });
});
