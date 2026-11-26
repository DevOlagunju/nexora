import { describe, expect, it } from "vitest";
import { accessLabel, accessVersion, isStaffAccess, staffChangeProblem, type StaffTarget } from "@/lib/staff-rules";

const customer: StaffTarget = { role: "USER", staffRole: null, hasCustomerActivity: false };
const trader: StaffTarget = { role: "USER", staffRole: null, hasCustomerActivity: true };
const finance: StaffTarget = { role: "ADMIN", staffRole: "FINANCE_OFFICER", hasCustomerActivity: false };
const superAdmin: StaffTarget = { role: "ADMIN", staffRole: "SUPER_ADMIN", hasCustomerActivity: false };

describe("staffChangeProblem", () => {
  it("lets a fresh account become staff, and staff change role or leave", () => {
    expect(staffChangeProblem(customer, "CUSTOMER_SUPPORT", 1)).toBeNull();
    expect(staffChangeProblem(finance, "OPERATIONS_MANAGER", 1)).toBeNull();
    expect(staffChangeProblem(finance, "NONE", 1)).toBeNull();
  });

  it("refuses a change that changes nothing", () => {
    expect(staffChangeProblem(finance, "FINANCE_OFFICER", 1)).toContain("already");
    expect(staffChangeProblem(customer, "NONE", 1)).toContain("already");
  });

  it("refuses to make a trading customer account into staff", () => {
    expect(staffChangeProblem(trader, "FINANCE_OFFICER", 1)).toContain("separate account");
    // Taking staff access away from someone is always allowed, whatever the account holds.
    expect(staffChangeProblem({ ...finance, hasCustomerActivity: true }, "NONE", 1)).toBeNull();
  });

  it("never removes the last Super Admin", () => {
    expect(staffChangeProblem(superAdmin, "NONE", 0)).toContain("last Super Admin");
    expect(staffChangeProblem(superAdmin, "AUDITOR", 0)).toContain("last Super Admin");
    expect(staffChangeProblem(superAdmin, "AUDITOR", 1)).toBeNull();
  });
});

describe("access helpers", () => {
  it("accepts staff roles and NONE only", () => {
    expect(isStaffAccess("NONE")).toBe(true);
    expect(isStaffAccess("AUDITOR")).toBe(true);
    expect(isStaffAccess("ADMIN")).toBe(false);
    expect(isStaffAccess("__proto__")).toBe(false);
  });

  it("names and versions an account's access", () => {
    expect(accessLabel({ role: "USER", staffRole: null })).toBe("Customer (no staff access)");
    expect(accessLabel({ role: "ADMIN", staffRole: null })).toBe("Staff, view only");
    expect(accessLabel({ role: "ADMIN", staffRole: "AUDITOR" })).toBe("Read-only Auditor");
    expect(accessVersion({ role: "ADMIN", staffRole: "AUDITOR" })).toBe("ADMIN:AUDITOR");
    expect(accessVersion({ role: "USER", staffRole: null })).toBe("USER:-");
  });
});
