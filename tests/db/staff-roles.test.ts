import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

import { prisma } from "@/lib/db";
import { decideApproval, requestApproval } from "@/lib/services/approvals";
import type { StaffRole } from "@/generated/prisma/enums";
import { makeAdmin, makeCustomer, settle } from "../helpers/fixtures";

const staff = async (staffRole: StaffRole) => {
  const a = await makeAdmin();
  await prisma.user.update({ where: { id: a.id }, data: { staffRole } });
  return { id: a.id, email: a.email, role: "ADMIN" as const, staffRole };
};
const freshAccount = async () => {
  const n = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return prisma.user.create({
    data: { email: `new-staff-${n}@example.test`, phone: `0807${n.slice(-8)}`, passwordHash: "x", fullName: "New Hire" },
  });
};
const accessOf = (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, select: { role: true, staffRole: true } });
const note = "Joined the finance team this week";

describe("staff access changes", () => {
  it("need a second Super Admin: nothing changes until they approve", async () => {
    const maker = await staff("SUPER_ADMIN");
    const checker = await staff("SUPER_ADMIN");
    const hire = await freshAccount();

    const req = await requestApproval(maker, "staff.role_change", { email: hire.email, role: "FINANCE_OFFICER", note });
    expect(req.ok).toBe(true);
    expect(await accessOf(hire.id)).toEqual({ role: "USER", staffRole: null });

    const self = await decideApproval(maker, { id: req.ok && req.data.id, decision: "approve" });
    expect(self).toMatchObject({ ok: false, status: 403 });

    const approved = await decideApproval(checker, { id: req.ok && req.data.id, decision: "approve" });
    expect(approved.ok).toBe(true);
    expect(await accessOf(hire.id)).toEqual({ role: "ADMIN", staffRole: "FINANCE_OFFICER" });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "admin.staff_role_set", userId: checker.id } });
    expect(JSON.parse(audit.meta!)).toMatchObject({ target: hire.email, from: "Customer (no staff access)", to: "Finance Officer" });
    await settle();
  });

  it("can only be asked for or approved by a Super Admin", async () => {
    const ops = await staff("OPERATIONS_MANAGER");
    const hire = await freshAccount();
    expect(await requestApproval(ops, "staff.role_change", { email: hire.email, role: "AUDITOR", note })).toMatchObject({ ok: false, status: 403 });

    const maker = await staff("SUPER_ADMIN");
    const req = await requestApproval(maker, "staff.role_change", { email: hire.email, role: "AUDITOR", note });
    expect(await decideApproval(ops, { id: req.ok && req.data.id, decision: "approve" })).toMatchObject({ ok: false, status: 403 });
    expect(await accessOf(hire.id)).toEqual({ role: "USER", staffRole: null });
  });

  it("refuses to turn a customer who has traded or holds money into staff", async () => {
    const maker = await staff("SUPER_ADMIN");
    const customer = await makeCustomer({ balanceNgn: 1_000 });
    const res = await requestApproval(maker, "staff.role_change", { email: customer.email, role: "SUPER_ADMIN", note });
    expect(res).toMatchObject({ ok: false, status: 422 });
    expect(await prisma.approvalRequest.count({ where: { action: "staff.role_change", payload: { contains: customer.id } } })).toBe(0);
  });

  it("checks the input before anything waits for approval", async () => {
    const maker = await staff("SUPER_ADMIN");
    const hire = await freshAccount();
    expect(await requestApproval(maker, "staff.role_change", { email: hire.email, role: "ADMIN", note })).toMatchObject({ ok: false });
    expect(await requestApproval(maker, "staff.role_change", { email: hire.email, role: "AUDITOR", note: "short" })).toMatchObject({ ok: false });
    expect(await requestApproval(maker, "staff.role_change", { email: "nobody@example.test", role: "AUDITOR", note })).toMatchObject({ ok: false, status: 404 });
  });

  it("signs someone out everywhere when their staff access is removed", async () => {
    const maker = await staff("SUPER_ADMIN");
    const checker = await staff("SUPER_ADMIN");
    const leaver = await staff("TRADING_OFFICER");
    await prisma.session.create({ data: { userId: leaver.id, tokenHash: `t-${leaver.id}`, expiresAt: new Date(Date.now() + 3_600_000) } });

    const req = await requestApproval(maker, "staff.role_change", { email: leaver.email, role: "NONE", note: "Left the company today" });
    expect((await decideApproval(checker, { id: req.ok && req.data.id, decision: "approve" })).ok).toBe(true);

    expect(await accessOf(leaver.id)).toEqual({ role: "USER", staffRole: null });
    expect(await prisma.session.count({ where: { userId: leaver.id } })).toBe(0);
    await settle();
  });

  it("fails instead of applying when their access changed after the request", async () => {
    const maker = await staff("SUPER_ADMIN");
    const checker = await staff("SUPER_ADMIN");
    const person = await staff("CUSTOMER_SUPPORT");

    const req = await requestApproval(maker, "staff.role_change", { email: person.email, role: "FINANCE_OFFICER", note });
    await prisma.user.update({ where: { id: person.id }, data: { staffRole: "AUDITOR" } }); // changed another way meanwhile

    const res = await decideApproval(checker, { id: req.ok && req.data.id, decision: "approve" });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(await accessOf(person.id)).toEqual({ role: "ADMIN", staffRole: "AUDITOR" });
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.ok ? req.data.id : "" } })).status).toBe("FAILED");
  });
});
