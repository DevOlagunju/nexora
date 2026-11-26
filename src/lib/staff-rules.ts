import type { StaffRole } from "@/generated/prisma/enums";
import { isStaffRole, STAFF_ROLE_LABEL } from "@/lib/permissions";

/**
 * Rules for giving, changing or removing staff access. Pure and unit tested
 * (tests/staff-rules.test.ts); applied through two-person approval in src/lib/services/approvals.ts.
 */

/** A staff role, or NONE to take staff access away (the account becomes an ordinary customer). */
export type StaffAccess = StaffRole | "NONE";

export type StaffTarget = {
  role: "USER" | "ADMIN";
  staffRole: StaffRole | null;
  /** Has orders or withdrawals, or money in the wallet: a customer account, not a staff one. */
  hasCustomerActivity: boolean;
};

export function isStaffAccess(value: string): value is StaffAccess {
  return value === "NONE" || isStaffRole(value);
}

export function accessLabel(user: { role: string; staffRole: StaffRole | null }): string {
  if (user.role !== "ADMIN") return "Customer (no staff access)";
  return user.staffRole ? STAFF_ROLE_LABEL[user.staffRole] : "Staff, view only";
}

export function accessChangeLabel(to: StaffAccess): string {
  return to === "NONE" ? "no staff access" : STAFF_ROLE_LABEL[to];
}

/** What the target's access is now, as a version string: a request fails if it changed meanwhile. */
export function accessVersion(user: { role: string; staffRole: StaffRole | null }): string {
  return `${user.role}:${user.staffRole ?? "-"}`;
}

/**
 * Why this change must not happen, or null if it may be requested.
 * `otherSuperAdmins` counts Super Admins other than the target.
 */
export function staffChangeProblem(target: StaffTarget, to: StaffAccess, otherSuperAdmins: number): string | null {
  const isStaff = target.role === "ADMIN";
  if ((to === "NONE" && !isStaff) || (isStaff && to !== "NONE" && target.staffRole === to)) {
    return "They already have that access.";
  }
  if (!isStaff && to !== "NONE" && target.hasCustomerActivity) {
    return "This account has traded or holds money, so it is a customer account. Staff need a separate account that has never traded.";
  }
  if (isStaff && target.staffRole === "SUPER_ADMIN" && to !== "SUPER_ADMIN" && otherSuperAdmins < 1) {
    return "This is the last Super Admin. Make someone else a Super Admin first.";
  }
  return null;
}
