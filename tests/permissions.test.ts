import { describe, expect, it } from "vitest";
import {
  can,
  denialMessage,
  isStaffRole,
  orderUpdatePermission,
  PERMISSIONS,
  permissionsOf,
  STAFF_ROLE_LABEL,
  type Permission,
} from "@/lib/permissions";
import type { StaffRole } from "@/generated/prisma/enums";

const ROLES = Object.keys(STAFF_ROLE_LABEL) as StaffRole[];
const ALL = Object.keys(PERMISSIONS) as Permission[];
const staff = (staffRole: StaffRole | null) => ({ role: "ADMIN", staffRole });

/** The whole matrix, written out, so any change to who-can-do-what shows up in review. */
const EXPECTED: Record<StaffRole, Permission[]> = {
  SUPER_ADMIN: ALL,
  OPERATIONS_MANAGER: [
    "desk.view",
    "rates.manage",
    "wallets.manage",
    "orders.review",
    "orders.payout",
    "giftcards.reveal",
    "withdrawals.process",
    "payouts.verify",
  ],
  TRADING_OFFICER: ["desk.view", "rates.manage", "orders.review", "giftcards.reveal"],
  FINANCE_OFFICER: ["desk.view", "orders.payout", "withdrawals.process", "payouts.verify"],
  COMPLIANCE_OFFICER: ["desk.view", "kyc.review"],
  CUSTOMER_SUPPORT: ["desk.view"],
  AUDITOR: ["desk.view"],
};

describe("staff permissions", () => {
  for (const role of ROLES) {
    for (const permission of ALL) {
      const allowed = EXPECTED[role].includes(permission);
      it(`${role} ${allowed ? "can" : "cannot"} ${permission}`, () => {
        expect(can(staff(role), permission)).toBe(allowed);
      });
    }
  }

  it("covers the seven staff roles in the specification", () => {
    expect(ROLES).toHaveLength(7);
    expect(Object.keys(EXPECTED).sort()).toEqual([...ROLES].sort());
  });

  it("gives customers nothing, whatever staff role is stored on the row", () => {
    for (const permission of ALL) {
      expect(can({ role: "USER", staffRole: "SUPER_ADMIN" }, permission)).toBe(false);
      expect(can(null, permission)).toBe(false);
    }
  });

  it("lets a staff account with no role look but not act", () => {
    expect(permissionsOf(staff(null))).toEqual(["desk.view"]);
  });

  it("keeps the people who set prices away from the money, and the reverse", () => {
    expect(can(staff("TRADING_OFFICER"), "orders.payout")).toBe(false);
    expect(can(staff("TRADING_OFFICER"), "withdrawals.process")).toBe(false);
    expect(can(staff("FINANCE_OFFICER"), "rates.manage")).toBe(false);
    expect(can(staff("FINANCE_OFFICER"), "wallets.manage")).toBe(false);
    expect(can(staff("FINANCE_OFFICER"), "orders.review")).toBe(false);
  });

  it("only a Super Admin manages staff", () => {
    expect(ROLES.filter((r) => can(staff(r), "staff.manage"))).toEqual(["SUPER_ADMIN"]);
  });

  it("explains a refusal with the role and the action", () => {
    const msg = denialMessage(staff("AUDITOR"), "withdrawals.process");
    expect(msg).toContain("Read-only Auditor");
    expect(msg).toContain("process withdrawals");
  });

  it("recognises role names", () => {
    expect(isStaffRole("FINANCE_OFFICER")).toBe(true);
    expect(isStaffRole("ADMIN")).toBe(false);
  });
});

describe("orderUpdatePermission", () => {
  it("treats releasing value as a payout action", () => {
    expect(orderUpdatePermission({ status: "APPROVED", triggerPayout: true })).toBe("orders.payout");
    expect(orderUpdatePermission({ status: "PAYOUT_SENT" })).toBe("orders.payout");
    expect(orderUpdatePermission({ status: "COMPLETED" })).toBe("orders.payout");
  });

  it("treats everything else as a review action", () => {
    for (const status of ["UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED", "AWAITING_DEPOSIT"]) {
      expect(orderUpdatePermission({ status })).toBe("orders.review");
    }
  });
});
