import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/security";
import { listAuditLog } from "@/lib/services/audit";
import { makeAdmin, makeCustomer } from "../helpers/fixtures";

describe("audit log is append-only", () => {
  it("refuses to edit a row", async () => {
    const user = await makeCustomer();
    await writeAudit("user.login", { userId: user.id, meta: { via: "test" } });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { userId: user.id } });

    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "user.logout" } })).rejects.toThrow();
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { meta: "{}" } })).rejects.toThrow();
    // Not even unlinking the person by hand while they still exist... unless nothing else changes.
    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { userId: null, action: "user.logout" } }),
    ).rejects.toThrow();

    const after = await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.action).toBe("user.login");
    expect(after.meta).toBe(JSON.stringify({ via: "test" }));
  });

  it("refuses to delete or truncate", async () => {
    const user = await makeCustomer();
    await writeAudit("user.login", { userId: user.id });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { userId: user.id } });

    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "AuditLog"`)).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { id: row.id } })).toBe(1);
  });

  it("keeps the event when its person is deleted, without the link", async () => {
    const user = await prisma.user.create({
      data: { email: `gone-${Date.now()}@example.test`, phone: `0809${Date.now() % 1e7}`, passwordHash: "x", fullName: "Gone Soon" },
    });
    await writeAudit("user.register", { userId: user.id, meta: { referredById: null } });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { userId: user.id } });

    await prisma.user.delete({ where: { id: user.id } });

    const kept = await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } });
    expect(kept.userId).toBeNull();
    expect(kept.action).toBe("user.register");
  });
});

describe("audit viewer query", () => {
  it("filters by group and finds events by reference, email or name", async () => {
    const admin = await makeAdmin();
    const customer = await makeCustomer();
    const ref = `NXW-AUDIT-${Date.now()}`;
    await writeAudit("wallet.withdraw_request", { userId: customer.id, meta: { reference: ref, amountNgn: 5_000 } });
    await writeAudit("admin.withdrawal_paid", { userId: admin.id, meta: { reference: ref } });
    await writeAudit("user.login_failed", { userId: customer.id });
    await writeAudit("cron.rates_sync", { meta: { source: "test" } });

    const byRef = await listAuditLog({ group: "all", q: ref, page: 1 });
    expect(byRef.rows.map((r) => r.action).sort()).toEqual(["admin.withdrawal_paid", "wallet.withdraw_request"]);

    const staffOnly = await listAuditLog({ group: "staff", q: ref, page: 1 });
    expect(staffOnly.rows.map((r) => r.action)).toEqual(["admin.withdrawal_paid"]);
    expect(staffOnly.rows[0].user?.role).toBe("ADMIN");

    const security = await listAuditLog({ group: "security", q: customer.email, page: 1 });
    expect(security.rows.map((r) => r.action)).toEqual(["user.login_failed"]);

    const system = await listAuditLog({ group: "system", q: "", page: 1 });
    expect(system.rows.some((r) => r.action === "cron.rates_sync" && r.user === null)).toBe(true);

    const byEmail = await listAuditLog({ group: "customer", q: customer.email.toUpperCase(), page: 1 });
    expect(byEmail.rows.map((r) => r.action).sort()).toEqual(["user.login_failed", "wallet.withdraw_request"]);
  });

  it("pages newest first and says when an older page exists", async () => {
    const user = await makeCustomer();
    const tag = `page-${user.id}`;
    for (let i = 0; i < 52; i++) await writeAudit("quote.create", { userId: user.id, meta: { tag, i } });

    const first = await listAuditLog({ group: "all", q: tag, page: 1 });
    expect(first.rows).toHaveLength(50);
    expect(first.hasOlder).toBe(true);
    const times = first.rows.map((r) => r.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const second = await listAuditLog({ group: "all", q: tag, page: 2 });
    expect(second.rows).toHaveLength(2);
    expect(second.hasOlder).toBe(false);
    // The two pages together are every event, each once.
    const seen = new Set([...first.rows, ...second.rows].map((r) => JSON.parse(r.meta!).i));
    expect(seen.size).toBe(52);
  });
});
