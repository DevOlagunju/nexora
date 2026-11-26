import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

import { prisma } from "@/lib/db";
import { APPROVAL_ACTIONS, decideApproval, requestApproval } from "@/lib/services/approvals";
import { makeAdmin, settle } from "../helpers/fixtures";

/**
 * Its own file (so its own database): it needs to know exactly how many Super Admins exist.
 */
describe("the last Super Admin", () => {
  it("can't be removed, even by two approvals landing at the same moment", async () => {
    const make = async () => {
      const a = await makeAdmin();
      await prisma.user.update({ where: { id: a.id }, data: { staffRole: "SUPER_ADMIN" } });
      return { id: a.id, email: a.email, role: "ADMIN" as const, staffRole: "SUPER_ADMIN" as const };
    };
    const ada = await make();
    const bayo = await make();
    expect(await prisma.user.count({ where: { staffRole: "SUPER_ADMIN" } })).toBe(2);

    // Each asks to demote the other: both requests are valid on their own.
    const demoteBayo = await requestApproval(ada, "staff.role_change", { email: bayo.email, role: "AUDITOR", note: "Moving to audit work" });
    const demoteAda = await requestApproval(bayo, "staff.role_change", { email: ada.email, role: "AUDITOR", note: "Moving to audit work" });
    expect(demoteBayo.ok && demoteAda.ok).toBe(true);

    // Each then approves the request that demotes themselves, at the same moment.
    const results = await Promise.all([
      decideApproval(bayo, { id: demoteBayo.ok && demoteBayo.data.id, decision: "approve" }),
      decideApproval(ada, { id: demoteAda.ok && demoteAda.data.id, decision: "approve" }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.find((r) => !r.ok);
    expect(refused && !refused.ok && refused.error).toContain("last Super Admin");
    expect(await prisma.user.count({ where: { staffRole: "SUPER_ADMIN" } })).toBe(1);
    await settle();
  });

  it("holds when the two changes are applied at exactly the same time", async () => {
    // Back to two Super Admins: promote a fresh account directly for this race.
    const third = await makeAdmin();
    await prisma.user.update({ where: { id: third.id }, data: { staffRole: "SUPER_ADMIN" } });
    const supers = await prisma.user.findMany({ where: { staffRole: "SUPER_ADMIN" }, select: { id: true, email: true, fullName: true } });
    expect(supers).toHaveLength(2);

    // Skip the request bookkeeping and run both applies head to head, so the two transactions
    // really overlap. Only the row lock in apply() keeps one Super Admin.
    const def = APPROVAL_ACTIONS["staff.role_change"];
    const witness = await makeAdmin(); // recorded as the approver in the audit log
    const approver = { id: witness.id, role: "ADMIN" as const, staffRole: "SUPER_ADMIN" as const };
    const payload = (u: (typeof supers)[number]) => ({ userId: u.id, email: u.email, fullName: u.fullName, from: "Super Admin", to: "AUDITOR", note: "race" });
    const results = await Promise.all(supers.map((u, i) => def.apply(approver, payload(u), `race-${i}`)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.user.count({ where: { staffRole: "SUPER_ADMIN" } })).toBe(1);
    await settle();
  });
});
