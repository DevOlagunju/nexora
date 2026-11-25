import type { StaffRole } from "@/generated/prisma/enums";

/**
 * Who on staff may do what. Pure and unit tested (tests/permissions.test.ts).
 * Least privilege: a capability is denied unless a role is listed for it here, and a
 * staff account with no role can look at the desk but change nothing.
 * Enforced on the server in src/app/actions.ts before any desk service runs.
 */

export const PERMISSIONS = {
  /** Open the admin desk and read its queues. */
  "desk.view": "View the desk",
  /** Change desk buy/sell rates, or sync them from the market. */
  "rates.manage": "Change rates",
  /** Change the platform's crypto deposit addresses. */
  "wallets.manage": "Change deposit addresses",
  /** Approve or reject customer KYC. */
  "kyc.review": "Review KYC",
  /** Move an order through review: approve, reject, reopen, add notes. */
  "orders.review": "Review orders",
  /** Release value on an order: trigger a payout, mark it paid out or completed. */
  "orders.payout": "Pay out orders",
  /** Decrypt a customer's gift card code. */
  "giftcards.reveal": "Reveal gift card codes",
  /** Pay, mark paid or reject wallet withdrawals. */
  "withdrawals.process": "Process withdrawals",
  /** Ask the payment provider what happened to a transfer. Moves no money by itself. */
  "payouts.verify": "Verify payouts",
  /** See what the business earned. */
  "reports.view": "View earnings",
  /** Give or change staff roles. */
  "staff.manage": "Manage staff",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  SUPER_ADMIN: "Super Admin",
  OPERATIONS_MANAGER: "Operations Manager",
  TRADING_OFFICER: "Trading Officer",
  FINANCE_OFFICER: "Finance Officer",
  COMPLIANCE_OFFICER: "Compliance Officer",
  CUSTOMER_SUPPORT: "Customer Support",
  AUDITOR: "Read-only Auditor",
};

const ALL = Object.keys(PERMISSIONS) as Permission[];

const GRANTS: Record<StaffRole, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  // Runs the desk day to day. Cannot approve KYC (compliance decides) or manage staff.
  OPERATIONS_MANAGER: [
    "desk.view",
    "rates.manage",
    "wallets.manage",
    "orders.review",
    "orders.payout",
    "giftcards.reveal",
    "withdrawals.process",
    "payouts.verify",
    "reports.view",
  ],
  // Verifies trades and sets prices. Cannot release Naira.
  TRADING_OFFICER: ["desk.view", "rates.manage", "orders.review", "giftcards.reveal"],
  // Releases Naira. Cannot change prices, addresses or trade decisions.
  FINANCE_OFFICER: ["desk.view", "orders.payout", "withdrawals.process", "payouts.verify", "reports.view"],
  COMPLIANCE_OFFICER: ["desk.view", "kyc.review"],
  CUSTOMER_SUPPORT: ["desk.view"],
  AUDITOR: ["desk.view", "reports.view"],
};

export type StaffActor = { role: string; staffRole?: StaffRole | null };

export function isStaff(user: StaffActor | null | undefined): boolean {
  return user?.role === "ADMIN";
}

export function can(user: StaffActor | null | undefined, permission: Permission): boolean {
  if (!user || !isStaff(user)) return false;
  // Every staff account may look; everything else needs a role that grants it.
  if (permission === "desk.view") return true;
  return !!user.staffRole && GRANTS[user.staffRole].includes(permission);
}

export function permissionsOf(user: StaffActor | null | undefined): Permission[] {
  return ALL.filter((p) => can(user, p));
}

export function staffRoleLabel(user: StaffActor): string {
  return user.staffRole ? STAFF_ROLE_LABEL[user.staffRole] : "No staff role";
}

/** Why a staff member was refused, in words the desk can act on. */
export function denialMessage(user: StaffActor, permission: Permission): string {
  return `Your role (${staffRoleLabel(user)}) is not allowed to: ${PERMISSIONS[permission].toLowerCase()}. Ask a Super Admin.`;
}

/**
 * The permission a desk order update needs. Releasing value (a payout, or marking an order
 * paid out / completed) is a finance action; everything else is a review action.
 */
export function orderUpdatePermission(input: { status: string; triggerPayout?: boolean }): Permission {
  return input.triggerPayout || input.status === "PAYOUT_SENT" || input.status === "COMPLETED"
    ? "orders.payout"
    : "orders.review";
}

export function isStaffRole(value: string): value is StaffRole {
  return value in STAFF_ROLE_LABEL;
}
