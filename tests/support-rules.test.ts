import { describe, expect, it } from "vitest";
import { isActive, newTicketSchema, replySchema, staffCanMove, staffMovesFrom, statusAfterCustomerReply } from "@/lib/support-rules";

describe("new ticket input", () => {
  it("accepts a ticket with or without a reference, normalising the reference", () => {
    const r = newTicketSchema.safeParse({ category: "WITHDRAWAL", subject: "Money not received", message: "My withdrawal shows paid but nothing arrived.", reference: " nxw-abc-123 " });
    expect(r.success && r.data.reference).toBe("NXW-ABC-123");
    const none = newTicketSchema.safeParse({ category: "OTHER", subject: "Question", message: "How long does KYC take usually?", reference: "" });
    expect(none.success && none.data.reference).toBeUndefined();
  });

  it("refuses unknown categories, empty subjects, short messages and odd references", () => {
    const base = { category: "TRADE", subject: "Help please", message: "Something went wrong with my trade." };
    expect(newTicketSchema.safeParse({ ...base, category: "REFUND" }).success).toBe(false);
    expect(newTicketSchema.safeParse({ ...base, subject: "Hi" }).success).toBe(false);
    expect(newTicketSchema.safeParse({ ...base, message: "help" }).success).toBe(false);
    expect(newTicketSchema.safeParse({ ...base, reference: "NXC-1; DROP TABLE" }).success).toBe(false);
    expect(newTicketSchema.safeParse({ ...base, message: "x".repeat(2_001) }).success).toBe(false);
  });

  it("needs a real reply", () => {
    expect(replySchema.safeParse({ message: " " }).success).toBe(false);
    expect(replySchema.safeParse({ message: "Thanks" }).success).toBe(true);
  });
});

describe("ticket statuses", () => {
  it("lets staff move an active or resolved ticket, but never reopen a closed one", () => {
    expect(staffCanMove("OPEN", "RESOLVED")).toBe(true);
    expect(staffCanMove("AWAITING_CUSTOMER", "OPEN")).toBe(true);
    expect(staffCanMove("RESOLVED", "OPEN")).toBe(true);
    expect(staffCanMove("OPEN", "OPEN")).toBe(false);
    expect(staffMovesFrom("CLOSED")).toEqual([]);
  });

  it("puts a ticket back in the queue when the customer writes, unless it is closed", () => {
    expect(statusAfterCustomerReply("AWAITING_CUSTOMER")).toBe("OPEN");
    expect(statusAfterCustomerReply("RESOLVED")).toBe("OPEN");
    expect(statusAfterCustomerReply("CLOSED")).toBeNull();
  });

  it("counts only open and waiting tickets as active", () => {
    expect(isActive("OPEN")).toBe(true);
    expect(isActive("AWAITING_CUSTOMER")).toBe(true);
    expect(isActive("RESOLVED")).toBe(false);
    expect(isActive("CLOSED")).toBe(false);
  });
});
