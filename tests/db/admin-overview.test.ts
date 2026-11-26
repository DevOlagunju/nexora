import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

import { prisma } from "@/lib/db";
import { adminOverview, pendingWork, pendingWorkIds, recentTransactions, systemStatus } from "@/lib/services/admin-overview";
import { makeCustomer } from "../helpers/fixtures";

const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY);
let seq = 0;

async function order(userId: string, o: { status: "COMPLETED" | "REJECTED" | "UNDER_REVIEW"; amountNgn: number; at: Date }) {
  return prisma.cryptoOrder.create({
    data: {
      reference: `NXC-OV-${Date.now().toString(36)}-${seq++}`,
      userId,
      symbol: "USDT",
      network: "TRC20",
      side: "SELL",
      amountCrypto: o.amountNgn / 1_500,
      rateNgn: 1_500,
      marketRateNgn: 1_520,
      amountNgn: o.amountNgn,
      status: o.status,
      completedAt: o.status === "COMPLETED" ? o.at : null,
      createdAt: o.at,
      updatedAt: o.at,
    },
  });
}

beforeAll(async () => {
  const a = await makeCustomer();
  const b = await makeCustomer();
  // This period (last 7 days): ₦300k completed, one rejected.
  await order(a.id, { status: "COMPLETED", amountNgn: 100_000, at: daysAgo(1) });
  await order(b.id, { status: "COMPLETED", amountNgn: 200_000, at: daysAgo(3) });
  await order(b.id, { status: "REJECTED", amountNgn: 50_000, at: daysAgo(2) });
  // The 7 days before: ₦150k completed.
  await order(a.id, { status: "COMPLETED", amountNgn: 150_000, at: daysAgo(10) });
  // Waiting for the desk.
  await order(a.id, { status: "UNDER_REVIEW", amountNgn: 75_000, at: daysAgo(0.1) });
});

describe("admin overview figures", () => {
  it("adds up completed trade volume for the period and compares it with the one before", async () => {
    const o = await adminOverview("7d");
    expect(o.kpis.volume.value).toBe(300_000);
    expect(o.kpis.volume.change).toBe(100); // 300k against 150k
    expect(o.kpis.volume.series.reduce((s, v) => s + v, 0)).toBe(300_000);
    expect(o.labels).toHaveLength(7);
  });

  it("counts the success rate from finished trades only", async () => {
    const o = await adminOverview("7d");
    expect(o.kpis.success.value).toBeCloseTo((2 / 3) * 100);
    expect(o.kpis.success.trades).toBe(3);
  });

  it("counts customers, not staff", async () => {
    const o = await adminOverview("30d");
    expect(o.kpis.users.value).toBe(await prisma.user.count({ where: { role: "USER" } }));
    expect(o.kpis.users.series[o.kpis.users.series.length - 1]).toBe(o.kpis.users.value);
  });

  it("lists recent transactions newest first and work waiting for the desk", async () => {
    const t = await recentTransactions(3);
    expect(t[0].status).toBe("UNDER_REVIEW");
    expect(t.map((r) => r.at.getTime())).toEqual([...t.map((r) => r.at.getTime())].sort((x, y) => y - x));

    const p = await pendingWork(5);
    expect(p.total).toBeGreaterThanOrEqual(1);
    expect(p.items.some((i) => i.kind === "crypto" && i.href === "/admin/desk#crypto")).toBe(true);
  });

  it("gives the bell an id for every waiting item, in the same form as the items it lists", async () => {
    const [p, ids] = await Promise.all([pendingWork(50), pendingWorkIds()]);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    // Opening the bell marks these ids seen, so each listed item must be among them.
    for (const i of p.items) expect(ids).toContain(`${i.kind}-${i.id}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("checks the database live", async () => {
    const s = await systemStatus();
    expect(s.checks.find((c) => c.name === "Database")?.ok).toBe(true);
    expect(s.dbMs).not.toBeNull();
  });
});
