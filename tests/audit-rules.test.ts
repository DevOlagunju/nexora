import { describe, expect, it } from "vitest";
import { actionKind, actionLabel, AUDIT_GROUPS, auditGroup, metaPairs, pageNumber } from "@/lib/audit-rules";

describe("audit groups", () => {
  it("reads a known group and falls back to everything", () => {
    expect(auditGroup("staff")).toBe("staff");
    expect(auditGroup("security")).toBe("security");
    expect(auditGroup("nope")).toBe("all");
    expect(auditGroup(undefined)).toBe("all");
    expect(auditGroup("__proto__")).toBe("all");
  });

  it("treats every security event as a real action code with a prefix", () => {
    for (const a of AUDIT_GROUPS.security.actions) expect(a).toMatch(/^[a-z]+\.[a-z_]+$/);
  });
});

describe("actionLabel", () => {
  it("uses the plain-words name when there is one", () => {
    expect(actionLabel("user.login_failed")).toBe("Failed sign-in");
    expect(actionLabel("admin.gift_code_reveal")).toBe("Revealed a gift card code");
    expect(actionLabel("quote.create")).toBe("Got a price quote");
  });

  it("derives a readable name for anything else", () => {
    expect(actionLabel("admin.asset_network_update")).toBe("Asset network update");
    expect(actionLabel("paystack.transfer.success")).toBe("Transfer success");
    expect(actionLabel("odd")).toBe("Odd");
  });
});

describe("actionKind", () => {
  it("separates staff, system and customer events", () => {
    expect(actionKind("admin.kyc_review")).toBe("staff");
    expect(actionKind("approval.approved")).toBe("staff");
    expect(actionKind("staff.login_refused")).toBe("staff");
    expect(actionKind("cron.rates_sync")).toBe("system");
    expect(actionKind("paystack.transfer.failed")).toBe("system");
    expect(actionKind("wallet.withdraw_request")).toBe("customer");
  });
});

describe("metaPairs", () => {
  it("shows stored JSON as key and value pairs, skipping empty values", () => {
    expect(metaPairs(JSON.stringify({ reference: "NXW123", amountNgn: 5000, note: "", gone: null }))).toEqual([
      { key: "reference", value: "NXW123" },
      { key: "amountNgn", value: "5000" },
    ]);
  });

  it("flattens nested values and cuts long ones", () => {
    const [nested] = metaPairs(JSON.stringify({ changes: { buy: 1 } }));
    expect(nested).toEqual({ key: "changes", value: '{"buy":1}' });
    const [long] = metaPairs(JSON.stringify({ note: "x".repeat(200) }), 20);
    expect(long.value).toHaveLength(20);
    expect(long.value.endsWith("…")).toBe(true);
  });

  it("copes with missing or non-object details", () => {
    expect(metaPairs(null)).toEqual([]);
    expect(metaPairs("not json")).toEqual([{ key: "details", value: "not json" }]);
    expect(metaPairs("[1,2]")).toEqual([{ key: "details", value: "[1,2]" }]);
  });
});

describe("pageNumber", () => {
  it("accepts whole pages from 1 and clamps the rest", () => {
    expect(pageNumber("3")).toBe(3);
    expect(pageNumber(undefined)).toBe(1);
    expect(pageNumber("0")).toBe(1);
    expect(pageNumber("-2")).toBe(1);
    expect(pageNumber("2.5")).toBe(1);
    expect(pageNumber("abc")).toBe(1);
    expect(pageNumber("999999")).toBe(1000);
  });
});
