import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cancelWithdrawal, creditWallet, debitWallet, requestWithdrawal } from "@/lib/services/wallet";
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
