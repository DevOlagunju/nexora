/**
 * Audit trail helpers for the admin viewer (/admin/audit). Pure and unit tested
 * (tests/audit-rules.test.ts); the query itself lives in src/lib/services/audit.ts.
 */

export const AUDIT_GROUPS = {
  all: { label: "Everything", prefixes: [] as string[], actions: [] as string[] },
  staff: { label: "Staff actions", prefixes: ["admin.", "approval.", "staff."], actions: [] },
  customer: {
    label: "Customer activity",
    prefixes: ["user.", "wallet.", "kyc.", "crypto.", "gift.", "quote.", "payment."],
    actions: [],
  },
  security: {
    label: "Security",
    prefixes: [],
    actions: [
      "user.login_failed",
      "user.password_change",
      "user.password_change_failed",
      "user.password_reset",
      "user.password_reset_failed",
      "user.password_reset_request",
      "user.pin_locked",
      "user.pin_change",
      "user.logout_all",
      "staff.login_refused",
      "admin.permission_denied",
      "admin.gift_code_reveal",
      "admin.staff_role_set",
    ],
  },
  system: { label: "System and providers", prefixes: ["cron.", "paystack."], actions: [] },
} as const;

export type AuditGroup = keyof typeof AUDIT_GROUPS;

export function auditGroup(raw: string | undefined): AuditGroup {
  // Own keys only: `in` would also accept "__proto__", "toString" and the like.
  return raw && Object.hasOwn(AUDIT_GROUPS, raw) ? (raw as AuditGroup) : "all";
}

/** Plain-words names for the actions the desk looks for most; anything else is derived from its code. */
const LABELS: Record<string, string> = {
  "user.register": "Signed up",
  "user.login": "Signed in",
  "user.login_failed": "Failed sign-in",
  "user.logout": "Signed out",
  "user.logout_all": "Signed out everywhere",
  "user.password_change": "Changed password",
  "user.password_change_failed": "Wrong password on change",
  "user.password_reset_request": "Asked for a password reset",
  "user.password_reset": "Reset password",
  "user.password_reset_failed": "Failed password reset",
  "user.pin_set": "Set transaction PIN",
  "user.pin_change": "Changed transaction PIN",
  "user.pin_locked": "Locked out by wrong PINs",
  "kyc.submit": "Submitted KYC",
  "wallet.withdraw_request": "Requested a withdrawal",
  "wallet.withdraw_cancel": "Cancelled a withdrawal",
  "wallet.referral_bonus": "Referral bonus paid",
  "quote.create": "Got a price quote",
  "payment.start": "Started a payment",
  "payment.success": "Payment received",
  "crypto.sell_create": "Created a crypto sell",
  "crypto.buy_create": "Created a crypto buy",
  "crypto.tx_submit": "Sent a deposit hash",
  "crypto.payment_submit": "Sent a payment reference",
  "crypto.cancel": "Cancelled a crypto order",
  "gift.sell_create": "Created a gift card sell",
  "admin.kyc_review": "Reviewed KYC",
  "admin.crypto_status": "Changed a crypto order",
  "admin.gift_status": "Changed a gift card order",
  "admin.gift_code_reveal": "Revealed a gift card code",
  "admin.withdrawal_paid": "Marked a withdrawal paid",
  "admin.withdrawal_reject": "Rejected a withdrawal",
  "admin.rate_update": "Changed a rate",
  "admin.permission_denied": "Was refused (no permission)",
  "admin.staff_role_set": "Changed staff access",
  "staff.login_refused": "Staff sign-in refused",
  "approval.requested": "Asked for approval",
  "approval.approved": "Approved a request",
  "approval.rejected": "Rejected a request",
};

export function actionLabel(action: string): string {
  if (LABELS[action]) return LABELS[action];
  const name = action.includes(".") ? action.slice(action.indexOf(".") + 1) : action;
  const words = name.replace(/[_.]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
}

/** Was this done by staff, a customer, or the system? Decides the badge colour. */
export function actionKind(action: string): "staff" | "customer" | "system" {
  if (AUDIT_GROUPS.staff.prefixes.some((p) => action.startsWith(p))) return "staff";
  if (AUDIT_GROUPS.system.prefixes.some((p) => action.startsWith(p))) return "system";
  return "customer";
}

/**
 * The stored JSON details as short "key: value" pairs for a table cell. Nested values are
 * flattened to JSON; long values are cut so one noisy row cannot swamp the page.
 */
export function metaPairs(meta: string | null, maxValue = 80): { key: string; value: string }[] {
  if (!meta) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(meta);
  } catch {
    return [{ key: "details", value: cut(meta, maxValue) }];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [{ key: "details", value: cut(String(meta), maxValue) }];
  }
  return Object.entries(parsed as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([key, v]) => ({ key, value: cut(typeof v === "string" ? v : JSON.stringify(v), maxValue) }));
}

function cut(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Page number from the address bar: whole, at least 1, at most 1000. */
export function pageNumber(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 1000) : 1;
}
