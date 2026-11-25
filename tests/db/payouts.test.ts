import { beforeEach, describe, expect, it, vi } from "vitest";

// Paystack is replaced at the network edge only: the pure helpers stay real.
const paystack = vi.hoisted(() => ({ payoutToBank: vi.fn(), verifyTransfer: vi.fn() }));
vi.mock("@/lib/paystack", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/paystack")>();
  return {
    ...real,
    paystackConfigured: () => true,
    payoutToBank: paystack.payoutToBank,
    payoutSellOrder: (input: { orderReference: string }) => paystack.payoutToBank({ ...input, reference: input.orderReference }),
    verifyTransfer: paystack.verifyTransfer,
  };
});

import { prisma } from "@/lib/db";
import { PAYOUT_NOT_FOUND_GRACE_MS } from "@/lib/payout-rules";
import {
  cancelWithdrawal,
  processWithdrawal,
  reconcileWithdrawalPayouts,
  requestWithdrawal,
  resolveWithdrawalPayout,
  settleWithdrawalTransfer,
} from "@/lib/services/wallet";
import { reconcileOrderPayouts, settleOrderTransfer, updateOrderStatus, verifyOrderPayout } from "@/lib/services/desk";
import { balanceOf, ledgerBalanceOf, makeAdmin, makeCustomer, makeSellOrder, settle, TEST_PIN } from "../helpers/fixtures";

const ctx = { ip: "127.0.0.1" };
const UNKNOWN = { ok: false, unknown: true, message: "Paystack did not respond in time" } as const;
const REJECTED = { ok: false, unknown: false, message: "Insufficient balance" } as const;

async function pendingWithdrawal() {
  const user = await makeCustomer({ balanceNgn: 10_000 });
  const res = await requestWithdrawal(user, { amountNgn: 5_000, pin: TEST_PIN }, ctx);
  expect(res.ok).toBe(true);
  const w = await prisma.withdrawal.findFirstOrThrow({ where: { userId: user.id } });
  return { user, w };
}

const reload = (id: string) => prisma.withdrawal.findUniqueOrThrow({ where: { id } });

beforeEach(() => {
  paystack.payoutToBank.mockReset();
  paystack.verifyTransfer.mockReset();
});

describe("withdrawal payout when Paystack does not answer", () => {
  it("holds the withdrawal as Processing: no refund, no cancel, no second send", async () => {
    const admin = await makeAdmin();
    const { user, w } = await pendingWithdrawal();
    paystack.payoutToBank.mockResolvedValue(UNKNOWN);

    const res = await processWithdrawal(admin, { id: w.id, action: "paystack" });
    expect(res.ok).toBe(false);

    const held = await reload(w.id);
    expect(held.status).toBe("PROCESSING");
    expect(held.payoutRef).toMatch(/^pending:/);

    // The customer cannot cancel and be refunded while the money may be on its way.
    expect((await cancelWithdrawal(user, { id: w.id })).ok).toBe(false);
    expect(await balanceOf(user.id)).toBe(4_950);

    // The desk cannot send it again or reject-and-refund it.
    expect((await processWithdrawal(admin, { id: w.id, action: "paystack" })).ok).toBe(false);
    expect((await processWithdrawal(admin, { id: w.id, action: "reject", note: "x" })).ok).toBe(false);
    expect(paystack.payoutToBank).toHaveBeenCalledTimes(1);
    await settle();
  });

  it("treats a thrown error as unknown too", async () => {
    const admin = await makeAdmin();
    const { w } = await pendingWithdrawal();
    paystack.payoutToBank.mockRejectedValue(new Error("socket hang up"));

    await processWithdrawal(admin, { id: w.id, action: "paystack" });
    expect((await reload(w.id)).status).toBe("PROCESSING");
    await settle();
  });

  it("marks it paid, with no refund, once Paystack confirms the transfer", async () => {
    const admin = await makeAdmin();
    const { user, w } = await pendingWithdrawal();
    paystack.payoutToBank.mockResolvedValue(UNKNOWN);
    await processWithdrawal(admin, { id: w.id, action: "paystack" });

    paystack.verifyTransfer.mockResolvedValue({ state: "success", transferCode: "TRF_ok", reason: null });
    const res = await processWithdrawal(admin, { id: w.id, action: "verify" });
    expect(res.ok).toBe(true);

    const paid = await reload(w.id);
    expect(paid.status).toBe("PAID");
    expect(paid.payoutRef).toBe("TRF_ok");
    expect(await balanceOf(user.id)).toBe(4_950);
    expect(await prisma.walletEntry.count({ where: { reference: `wd-refund:${w.reference}` } })).toBe(0);
    await settle();
  });

  it("refunds exactly once when Paystack says the transfer failed, however many times it is told", async () => {
    const admin = await makeAdmin();
    const { user, w } = await pendingWithdrawal();
    paystack.payoutToBank.mockResolvedValue(UNKNOWN);
    await processWithdrawal(admin, { id: w.id, action: "paystack" });

    paystack.verifyTransfer.mockResolvedValue({ state: "failed", transferCode: "TRF_bad", reason: "Account closed" });
    await processWithdrawal(admin, { id: w.id, action: "verify" });
    // The webhook for the same failure arrives as well, twice.
    await settleWithdrawalTransfer("TRF_bad", false, "Account closed", `nxp-${w.reference}`);
    await settleWithdrawalTransfer("TRF_bad", false, "Account closed", `nxp-${w.reference}`);

    expect((await reload(w.id)).status).toBe("FAILED");
    expect(await balanceOf(user.id)).toBe(10_000);
    expect(await ledgerBalanceOf(user.id)).toBe(10_000);
    expect(await prisma.walletEntry.count({ where: { reference: `wd-refund:${w.reference}` } })).toBe(1);
    await settle();
  });

  it("only releases an unanswered transfer after Paystack has had time to register it", async () => {
    const admin = await makeAdmin();
    const { w } = await pendingWithdrawal();
    paystack.payoutToBank.mockResolvedValue(UNKNOWN);
    await processWithdrawal(admin, { id: w.id, action: "paystack" });
    paystack.verifyTransfer.mockResolvedValue({ state: "not_found", transferCode: null, reason: null });

    expect(await resolveWithdrawalPayout(await reload(w.id))).toBe("wait");
    expect((await reload(w.id)).status).toBe("PROCESSING");

    const later = Date.now() + PAYOUT_NOT_FOUND_GRACE_MS + 1_000;
    expect(await resolveWithdrawalPayout(await reload(w.id), later)).toBe("never_sent");
    const released = await reload(w.id);
    expect(released.status).toBe("PENDING");
    expect(released.payoutRef).toBeNull();
  });

  it("leaves everything alone when Paystack cannot be reached to verify", async () => {
    const admin = await makeAdmin();
    const { user, w } = await pendingWithdrawal();
    paystack.payoutToBank.mockResolvedValue(UNKNOWN);
    await processWithdrawal(admin, { id: w.id, action: "paystack" });
    paystack.verifyTransfer.mockRejectedValue(new Error("Could not reach Paystack"));

    expect((await processWithdrawal(admin, { id: w.id, action: "verify" })).ok).toBe(false);
    expect((await reload(w.id)).status).toBe("PROCESSING");
    expect(await balanceOf(user.id)).toBe(4_950);
  });

  it("settles from the webhook by our own reference when the transfer code was never recorded", async () => {
    const admin = await makeAdmin();
    const { w } = await pendingWithdrawal();
    paystack.payoutToBank.mockResolvedValue(UNKNOWN);
    await processWithdrawal(admin, { id: w.id, action: "paystack" });

    const res = await settleWithdrawalTransfer("TRF_late", true, undefined, `nxp-${w.reference}`);
    expect(res).toEqual({ reference: w.reference, applied: true });
    const paid = await reload(w.id);
    expect(paid.status).toBe("PAID");
    expect(paid.payoutRef).toBe("TRF_late");
    await settle();
  });

  it("the reconcile sweep resolves a stuck withdrawal", async () => {
    const admin = await makeAdmin();
    const { w } = await pendingWithdrawal();
    paystack.payoutToBank.mockResolvedValue(UNKNOWN);
    await processWithdrawal(admin, { id: w.id, action: "paystack" });
    paystack.verifyTransfer.mockResolvedValue({ state: "success", transferCode: "TRF_swept", reason: null });

    const result = await reconcileWithdrawalPayouts(new Date(Date.now() + 5 * 60_000));
    expect(result.resolved).toBeGreaterThanOrEqual(1);
    expect((await reload(w.id)).status).toBe("PAID");
    await settle();
  });
});

describe("withdrawal payout with a definite answer", () => {
  it("goes back to Pending when Paystack rejects the transfer outright", async () => {
    const admin = await makeAdmin();
    const { w } = await pendingWithdrawal();
    paystack.payoutToBank.mockResolvedValue(REJECTED);

    expect((await processWithdrawal(admin, { id: w.id, action: "paystack" })).ok).toBe(false);
    const back = await reload(w.id);
    expect(back.status).toBe("PENDING");
    expect(back.payoutRef).toBeNull();
  });

  it("records the transfer code on success and completes on the webhook", async () => {
    const admin = await makeAdmin();
    const { w } = await pendingWithdrawal();
    paystack.payoutToBank.mockResolvedValue({ ok: true, payoutRef: "TRF_1", status: "pending" });

    expect((await processWithdrawal(admin, { id: w.id, action: "paystack" })).ok).toBe(true);
    expect((await reload(w.id)).payoutRef).toBe("TRF_1");

    await settleWithdrawalTransfer("TRF_1", true);
    expect((await reload(w.id)).status).toBe("PAID");
    await settle();
  });
});

describe("sell-order payout when Paystack does not answer", () => {
  const orderOf = (id: string) => prisma.cryptoOrder.findUniqueOrThrow({ where: { id } });

  it("keeps the payout lock so the order cannot be paid again or by hand", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const order = await makeSellOrder(user.id);
    paystack.payoutToBank.mockResolvedValue(UNKNOWN);

    const res = await updateOrderStatus(admin, "crypto", { id: order.id, status: "APPROVED", triggerPayout: true });
    expect(res.ok).toBe(false);
    const locked = await orderOf(order.id);
    expect(locked.status).toBe("APPROVED");
    expect(locked.payoutRef).toMatch(/^pending:/);

    // No second Paystack send, and no closing it with a hand-typed bank reference.
    expect((await updateOrderStatus(admin, "crypto", { id: order.id, status: "APPROVED", triggerPayout: true })).ok).toBe(false);
    expect((await updateOrderStatus(admin, "crypto", { id: order.id, status: "COMPLETED", payoutRef: "manual-123" })).ok).toBe(false);
    expect(paystack.payoutToBank).toHaveBeenCalledTimes(1);
    expect((await orderOf(order.id)).payoutRef).toMatch(/^pending:/);
    await settle();
  });

  it("completes the order when Verify finds the transfer succeeded", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const order = await makeSellOrder(user.id);
    paystack.payoutToBank.mockResolvedValue(UNKNOWN);
    await updateOrderStatus(admin, "crypto", { id: order.id, status: "APPROVED", triggerPayout: true });

    paystack.verifyTransfer.mockResolvedValue({ state: "success", transferCode: "TRF_o1", reason: null });
    expect((await verifyOrderPayout(admin, "crypto", { id: order.id })).ok).toBe(true);

    const done = await orderOf(order.id);
    expect(done.status).toBe("COMPLETED");
    expect(done.payoutRef).toBe("TRF_o1");
    await settle();
  });

  it("completes from the webhook by reference, and a repeated webhook changes nothing", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const order = await makeSellOrder(user.id);
    paystack.payoutToBank.mockResolvedValue(UNKNOWN);
    await updateOrderStatus(admin, "crypto", { id: order.id, status: "APPROVED", triggerPayout: true });

    const evt = { transferCode: "TRF_o2", transferRef: `nxp-${order.reference}`, success: true, event: "transfer.success" };
    expect((await settleOrderTransfer(evt))?.applied).toBe(true);
    expect((await settleOrderTransfer(evt))?.applied).toBe(false);
    expect((await orderOf(order.id)).status).toBe("COMPLETED");
    await settle();
  });

  it("frees the order for a manual payout when Paystack says the transfer failed", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const order = await makeSellOrder(user.id);
    paystack.payoutToBank.mockResolvedValue(UNKNOWN);
    await updateOrderStatus(admin, "crypto", { id: order.id, status: "APPROVED", triggerPayout: true });

    paystack.verifyTransfer.mockResolvedValue({ state: "failed", transferCode: "TRF_o3", reason: "Invalid account" });
    await verifyOrderPayout(admin, "crypto", { id: order.id });

    const freed = await orderOf(order.id);
    expect(freed.status).toBe("APPROVED");
    expect(freed.payoutRef).toBeNull();
    expect((await updateOrderStatus(admin, "crypto", { id: order.id, status: "COMPLETED", payoutRef: "manual-123" })).ok).toBe(true);
    await settle();
  });

  it("the reconcile sweep completes a payout whose webhook never arrived", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const order = await makeSellOrder(user.id);
    paystack.payoutToBank.mockResolvedValue({ ok: true, payoutRef: "TRF_o4", status: "pending" });
    expect((await updateOrderStatus(admin, "crypto", { id: order.id, status: "APPROVED", triggerPayout: true })).ok).toBe(true);
    expect((await orderOf(order.id)).status).toBe("PAYOUT_SENT");

    paystack.verifyTransfer.mockResolvedValue({ state: "success", transferCode: "TRF_o4", reason: null });
    await reconcileOrderPayouts(new Date(Date.now() + 5 * 60_000));
    expect((await orderOf(order.id)).status).toBe("COMPLETED");
    await settle();
  });
});

describe("sell order paid into the wallet", () => {
  it("credits the wallet once when the desk completes the order", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const order = await makeSellOrder(user.id, { amountNgn: 150_000, payoutMethod: "WALLET" });

    expect((await updateOrderStatus(admin, "crypto", { id: order.id, status: "COMPLETED" })).ok).toBe(true);
    // Saving the completed order again must not credit again.
    await updateOrderStatus(admin, "crypto", { id: order.id, status: "COMPLETED" });

    expect(await balanceOf(user.id)).toBe(150_000);
    expect(await ledgerBalanceOf(user.id)).toBe(150_000);
    expect(await prisma.walletEntry.count({ where: { reference: `order:${order.reference}` } })).toBe(1);
    await settle();
  });
});
