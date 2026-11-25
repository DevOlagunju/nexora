import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

import { prisma } from "@/lib/db";
import { cancelApproval, decideApproval, listApprovals, requestApproval } from "@/lib/services/approvals";
import { updateAssetNetwork } from "@/lib/services/assets";
import type { StaffRole } from "@/generated/prisma/enums";
import { balanceOf, ledgerBalanceOf, makeAdmin, makeCustomer, settle } from "../helpers/fixtures";

const TRON_ADDRESS = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
const OTHER_TRON = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7";
const ids: Record<string, string> = {};

const staff = async (staffRole: StaffRole) => {
  const a = await makeAdmin();
  await prisma.user.update({ where: { id: a.id }, data: { staffRole } });
  return { id: a.id, role: "ADMIN" as const, staffRole };
};
const trc20 = () => prisma.assetNetwork.findUniqueOrThrow({ where: { id: ids.trc20 } });
const base = { depositMemo: "", confirmations: "20", depositsEnabled: "on", withdrawalsEnabled: "on", isDefault: "on", note: "" };

beforeAll(async () => {
  await prisma.rate.create({ data: { kind: "CRYPTO", symbol: "USDT", displayName: "Tether", sellRateNgn: 1500, buyRateNgn: 1520, minAmount: 1 } });
  const network = await prisma.blockchainNetwork.findUniqueOrThrow({ where: { code: "TRC20" } });
  const row = await prisma.assetNetwork.create({
    data: { symbol: "USDT", networkId: network.id, depositAddress: "TDeskTronDepositAddress00000000001", confirmations: 20, isDefault: true },
  });
  ids.trc20 = row.id;
});

describe("deposit address changes", () => {
  it("are not applied when requested, and the requester cannot approve them", async () => {
    const maker = await staff("OPERATIONS_MANAGER");
    const req = await requestApproval(maker, "asset_network.update", { ...base, id: ids.trc20, depositAddress: TRON_ADDRESS });
    expect(req.ok).toBe(true);
    expect((await trc20()).depositAddress).toBe("TDeskTronDepositAddress00000000001");

    const self = await decideApproval(maker, { id: req.ok && req.data.id, decision: "approve" });
    expect(self).toMatchObject({ ok: false, status: 403 });
    expect((await trc20()).depositAddress).toBe("TDeskTronDepositAddress00000000001");

    // The database refuses it too, whatever the code does.
    await expect(
      prisma.approvalRequest.update({ where: { id: req.ok ? req.data.id : "" }, data: { decidedById: maker.id } }),
    ).rejects.toThrow();
  });

  it("are applied when a second person with the permission approves", async () => {
    const maker = await staff("OPERATIONS_MANAGER");
    const checker = await staff("SUPER_ADMIN");
    const req = await requestApproval(maker, "asset_network.update", { ...base, id: ids.trc20, depositAddress: TRON_ADDRESS });
    const id = req.ok ? req.data.id : "";
    expect(req.ok && (await prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).summary).toContain(TRON_ADDRESS);

    const res = await decideApproval(checker, { id, decision: "approve" });
    expect(res.ok).toBe(true);
    expect((await trc20()).depositAddress).toBe(TRON_ADDRESS);
    expect(await prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "APPROVED", decidedById: checker.id });
    expect(await prisma.auditLog.count({ where: { userId: checker.id, action: "approval.approved" } })).toBe(1);

    // Deciding again does nothing.
    expect(await decideApproval(checker, { id, decision: "approve" })).toMatchObject({ ok: false, status: 409 });
  });

  it("are refused up front when invalid, so nothing bad waits for approval", async () => {
    const maker = await staff("OPERATIONS_MANAGER");
    const bad = await requestApproval(maker, "asset_network.update", { ...base, id: ids.trc20, depositAddress: "0x52908400098527886E0F7030069857D2E4169EE7" });
    expect(bad).toMatchObject({ ok: false, status: 422 });
    const same = await requestApproval(maker, "asset_network.update", { ...base, id: ids.trc20, depositAddress: TRON_ADDRESS });
    expect(same).toMatchObject({ ok: false });
    expect(!same.ok && same.error).toMatch(/Nothing changed/);
  });

  it("leave everything as it was when rejected", async () => {
    const maker = await staff("OPERATIONS_MANAGER");
    const checker = await staff("SUPER_ADMIN");
    const req = await requestApproval(maker, "asset_network.update", { ...base, id: ids.trc20, depositAddress: OTHER_TRON });
    const res = await decideApproval(checker, { id: req.ok ? req.data.id : "", decision: "reject", note: "Not our wallet" });
    expect(res.ok).toBe(true);
    expect((await trc20()).depositAddress).toBe(TRON_ADDRESS);
  });

  it("fail instead of applying when the network was edited after the request", async () => {
    const maker = await staff("OPERATIONS_MANAGER");
    const checker = await staff("SUPER_ADMIN");
    const req = await requestApproval(maker, "asset_network.update", { ...base, id: ids.trc20, depositAddress: OTHER_TRON });
    const id = req.ok ? req.data.id : "";
    // Someone changes the row in the meantime.
    expect((await updateAssetNetwork(checker, { ...base, id: ids.trc20, depositAddress: TRON_ADDRESS, confirmations: "21" })).ok).toBe(true);

    const res = await decideApproval(checker, { id, decision: "approve" });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect((await trc20()).depositAddress).toBe(TRON_ADDRESS);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
  });

  it("need the permission to request and to approve", async () => {
    const support = await staff("CUSTOMER_SUPPORT");
    expect(await requestApproval(support, "asset_network.update", { ...base, id: ids.trc20, depositAddress: OTHER_TRON })).toMatchObject({ ok: false, status: 403 });

    const maker = await staff("OPERATIONS_MANAGER");
    const finance = await staff("FINANCE_OFFICER");
    const req = await requestApproval(maker, "asset_network.update", { ...base, id: ids.trc20, depositAddress: OTHER_TRON });
    expect(await decideApproval(finance, { id: req.ok ? req.data.id : "", decision: "approve" })).toMatchObject({ ok: false, status: 403 });
    expect(await cancelApproval(finance, { id: req.ok ? req.data.id : "" })).toMatchObject({ ok: false });
    expect(await cancelApproval(maker, { id: req.ok ? req.data.id : "" })).toMatchObject({ ok: true });
  });

  it("expire after their lifetime", async () => {
    const maker = await staff("OPERATIONS_MANAGER");
    const checker = await staff("SUPER_ADMIN");
    const req = await requestApproval(maker, "asset_network.update", { ...base, id: ids.trc20, depositAddress: OTHER_TRON });
    const id = req.ok ? req.data.id : "";
    await prisma.approvalRequest.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await decideApproval(checker, { id, decision: "approve" })).toMatchObject({ ok: false, status: 409 });
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).status).toBe("EXPIRED");
    expect((await trc20()).depositAddress).toBe(TRON_ADDRESS);
    const { pending } = await listApprovals();
    expect(pending.find((r) => r.id === id)).toBeUndefined();
  });
});

describe("wallet adjustments", () => {
  it("credit the wallet through the ledger once approved with a note", async () => {
    const customer = await makeCustomer({ balanceNgn: 1_000 });
    const maker = await staff("FINANCE_OFFICER");
    const checker = await staff("FINANCE_OFFICER");
    const req = await requestApproval(maker, "ledger.adjustment", {
      email: customer.email,
      direction: "CREDIT",
      amountNgn: "2500.555",
      reasonCode: "MISSED_CREDIT",
      note: "Order NX-123 paid out but never credited",
    });
    const id = req.ok ? req.data.id : "";
    expect(await balanceOf(customer.id)).toBe(1_000);
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).summary).toContain("2,500.56");

    expect(await decideApproval(checker, { id, decision: "approve" })).toMatchObject({ ok: false, status: 422 });
    expect(await decideApproval(checker, { id, decision: "approve", note: "Checked the provider statement" })).toMatchObject({ ok: true });
    expect(await balanceOf(customer.id)).toBe(3_500.56);
    expect(await ledgerBalanceOf(customer.id)).toBe(3_500.56);
    expect(await decideApproval(checker, { id, decision: "approve", note: "again" })).toMatchObject({ ok: false, status: 409 });
    expect(await balanceOf(customer.id)).toBe(3_500.56);
    await settle();
  });

  it("debit the wallet, and fail cleanly when the money is no longer there", async () => {
    const customer = await makeCustomer({ balanceNgn: 1_000 });
    const maker = await staff("FINANCE_OFFICER");
    const checker = await staff("SUPER_ADMIN");
    const input = { email: customer.email, direction: "DEBIT", amountNgn: 800, reasonCode: "DUPLICATE_CHARGE", note: "Credited twice for order NX-9" };

    expect(await requestApproval(maker, "ledger.adjustment", { ...input, amountNgn: 1_500 })).toMatchObject({ ok: false, status: 422 });
    const first = await requestApproval(maker, "ledger.adjustment", input);
    const second = await requestApproval(maker, "ledger.adjustment", input);

    expect(await decideApproval(checker, { id: first.ok ? first.data.id : "", decision: "approve", note: "Seen both credits" })).toMatchObject({ ok: true });
    expect(await balanceOf(customer.id)).toBe(200);

    const res = await decideApproval(checker, { id: second.ok ? second.data.id : "", decision: "approve", note: "Seen both credits" });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: second.ok ? second.data.id : "" } })).status).toBe("FAILED");
    expect(await balanceOf(customer.id)).toBe(200);
    expect(await ledgerBalanceOf(customer.id)).toBe(200);
    await settle();
  });

  it("cannot be requested or approved by roles without the permission", async () => {
    const customer = await makeCustomer({ balanceNgn: 1_000 });
    const ops = await staff("OPERATIONS_MANAGER");
    const input = { email: customer.email, direction: "CREDIT", amountNgn: 100, reasonCode: "GOODWILL", note: "Sorry for the delay on payout" };
    expect(await requestApproval(ops, "ledger.adjustment", input)).toMatchObject({ ok: false, status: 403 });

    const finance = await staff("FINANCE_OFFICER");
    const req = await requestApproval(finance, "ledger.adjustment", input);
    expect(await decideApproval(ops, { id: req.ok ? req.data.id : "", decision: "approve", note: "Looks fine to me" })).toMatchObject({ ok: false, status: 403 });
    expect(await balanceOf(customer.id)).toBe(1_000);
  });
});
