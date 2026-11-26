import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cancelWithdrawal, creditWallet, debitWallet, getWalletOverview, requestWithdrawal } from "@/lib/services/wallet";
import { balanceOf, ledgerBalanceOf, makeCustomer, settle, TEST_PIN } from "../helpers/fixtures";

const ctx = { ip: "127.0.0.1" };

describe("wallet ledger", () => {
  it("applies a credit once per reference", async () => {
    const user = await makeCustomer();
    const credit = () =>
      prisma.$transaction((tx) =>
        creditWallet(tx, { userId: user.id, amountNgn: 2_500, reference: `fund:once-${user.id}`, description: "Top-up", kind: "deposit" }),
      );

    expect(await credit()).toBe(true);
    expect(await credit()).toBe(false);
    expect(await balanceOf(user.id)).toBe(2_500);
    expect(await prisma.walletEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it("refuses a debit the balance does not cover and writes nothing", async () => {
    const user = await makeCustomer({ balanceNgn: 1_000 });
    const debited = await prisma.$transaction((tx) =>
      debitWallet(tx, { userId: user.id, amountNgn: 1_000.01, reference: `buy:over-${user.id}`, description: "Too much", kind: "purchase" }),
    );

    expect(debited).toBe(false);
    expect(await balanceOf(user.id)).toBe(1_000);
    expect(await prisma.walletEntry.count({ where: { userId: user.id, direction: "DEBIT" } })).toBe(0);
  });

  it("never lets simultaneous spends take the balance below zero", async () => {
    const user = await makeCustomer({ balanceNgn: 1_000 });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        prisma
          .$transaction((tx) =>
            debitWallet(tx, { userId: user.id, amountNgn: 400, reference: `buy:race-${user.id}-${i}`, description: "Race", kind: "purchase" }),
          )
          .catch(() => false),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(2);
    expect(await balanceOf(user.id)).toBe(200);
    expect(await ledgerBalanceOf(user.id)).toBe(200);
  });

  it("keeps the cached balance equal to the ledger through a withdrawal and its refund", async () => {
    const user = await makeCustomer({ balanceNgn: 10_000 });

    const requested = await requestWithdrawal(user, { amountNgn: 5_000, pin: TEST_PIN }, ctx);
    expect(requested.ok).toBe(true);
    // Fee is charged on top: 5,000 + 50.
    expect(await balanceOf(user.id)).toBe(4_950);
    expect(await ledgerBalanceOf(user.id)).toBe(4_950);

    const w = await prisma.withdrawal.findFirstOrThrow({ where: { userId: user.id } });
    expect((await cancelWithdrawal(user, { id: w.id })).ok).toBe(true);
    // A second cancel must not refund again.
    expect((await cancelWithdrawal(user, { id: w.id })).ok).toBe(false);

    expect(await balanceOf(user.id)).toBe(10_000);
    expect(await ledgerBalanceOf(user.id)).toBe(10_000);
    await settle();
  });

  it("stores amounts exactly: ten credits of 0.1 make exactly 1", async () => {
    const user = await makeCustomer();
    for (let i = 0; i < 10; i++) {
      await prisma.$transaction((tx) =>
        creditWallet(tx, { userId: user.id, amountNgn: 0.1, reference: `fund:dime-${user.id}-${i}`, description: "0.1", kind: "deposit" }),
      );
    }
    expect(await balanceOf(user.id)).toBe(1);
    const sum = await prisma.walletEntry.aggregate({ where: { userId: user.id }, _sum: { amountNgn: true } });
    expect(String(sum._sum.amountNgn)).toBe("1");
  });

  it("the database itself refuses a negative balance and a non-positive ledger amount", async () => {
    const user = await makeCustomer({ balanceNgn: 100 });
    await expect(
      prisma.user.update({ where: { id: user.id }, data: { walletBalanceNgn: { decrement: 100.01 } } }),
    ).rejects.toThrow();
    await expect(
      prisma.walletEntry.create({
        data: { userId: user.id, direction: "DEBIT", amountNgn: 0, reference: `bad:${user.id}`, description: "zero" },
      }),
    ).rejects.toThrow();
    expect(await balanceOf(user.id)).toBe(100);
  });

  it("rejects a withdrawal with the wrong PIN without touching the balance", async () => {
    const user = await makeCustomer({ balanceNgn: 10_000 });
    const res = await requestWithdrawal(user, { amountNgn: 5_000, pin: "0000" }, ctx);

    expect(res.ok).toBe(false);
    expect(await balanceOf(user.id)).toBe(10_000);
    expect(await prisma.withdrawal.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("daily withdrawal limit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses the withdrawal that would go over the day's amount, and charges nothing for it", async () => {
    vi.stubEnv("WALLET_DAILY_WITHDRAWAL_LIMIT_NGN", "8000");
    const user = await makeCustomer({ balanceNgn: 50_000 });

    expect((await requestWithdrawal(user, { amountNgn: 5_000, pin: TEST_PIN }, ctx)).ok).toBe(true);
    const over = await requestWithdrawal(user, { amountNgn: 3_001, pin: TEST_PIN }, ctx);
    expect(over.ok).toBe(false);
    expect(!over.ok && over.error).toContain("₦3,000 more today");
    // 50,000 - (5,000 + 50 fee): the refused one moved nothing.
    expect(await balanceOf(user.id)).toBe(44_950);
    expect(await ledgerBalanceOf(user.id)).toBe(44_950);

    expect((await requestWithdrawal(user, { amountNgn: 3_000, pin: TEST_PIN }, ctx)).ok).toBe(true);
    expect(await prisma.withdrawal.count({ where: { userId: user.id } })).toBe(2);
    await settle();
  });

  it("refuses once the day's number of withdrawals is used", async () => {
    vi.stubEnv("WALLET_DAILY_WITHDRAWAL_COUNT", "2");
    const user = await makeCustomer({ balanceNgn: 50_000 });

    expect((await requestWithdrawal(user, { amountNgn: 1_000, pin: TEST_PIN }, ctx)).ok).toBe(true);
    expect((await requestWithdrawal(user, { amountNgn: 1_000, pin: TEST_PIN }, ctx)).ok).toBe(true);
    const third = await requestWithdrawal(user, { amountNgn: 1_000, pin: TEST_PIN }, ctx);
    expect(!third.ok && third.error).toContain("2 withdrawals a day");
    await settle();
  });

  it("does not count a cancelled withdrawal, because its money came back", async () => {
    vi.stubEnv("WALLET_DAILY_WITHDRAWAL_LIMIT_NGN", "5000");
    const user = await makeCustomer({ balanceNgn: 50_000 });

    expect((await requestWithdrawal(user, { amountNgn: 5_000, pin: TEST_PIN }, ctx)).ok).toBe(true);
    const w = await prisma.withdrawal.findFirstOrThrow({ where: { userId: user.id } });
    expect((await cancelWithdrawal(user, { id: w.id })).ok).toBe(true);

    expect((await requestWithdrawal(user, { amountNgn: 5_000, pin: TEST_PIN }, ctx)).ok).toBe(true);
    await settle();
  });

  it("never lets simultaneous requests pass the day's amount together", async () => {
    vi.stubEnv("WALLET_DAILY_WITHDRAWAL_LIMIT_NGN", "10000");
    const user = await makeCustomer({ balanceNgn: 100_000 });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => requestWithdrawal(user, { amountNgn: 4_000, pin: TEST_PIN }, ctx).catch(() => ({ ok: false }))),
    );

    // 4,000 + 4,000 fits under 10,000; a third would make 12,000.
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    const sum = await prisma.withdrawal.aggregate({ where: { userId: user.id }, _sum: { amountNgn: true } });
    expect(Number(sum._sum.amountNgn)).toBe(8_000);
    expect(await balanceOf(user.id)).toBe(100_000 - 2 * 4_050);
    await settle();
  });

  it("shows the customer what is left of the day", async () => {
    vi.stubEnv("WALLET_DAILY_WITHDRAWAL_LIMIT_NGN", "10000");
    const user = await makeCustomer({ balanceNgn: 100_000 });
    expect((await requestWithdrawal(user, { amountNgn: 7_500, pin: TEST_PIN }, ctx)).ok).toBe(true);

    const overview = await getWalletOverview(user.id);
    expect(overview.maxWithdrawable).toBe(2_500);
    expect(overview.dailyWithdrawals).toEqual({ usedNgn: 7_500, limitNgn: 10_000, count: 1, countLimit: 5 });
    await settle();
  });
});
