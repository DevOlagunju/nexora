import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { customerAccountCode, SYSTEM_ACCOUNTS } from "@/lib/ledger/accounts";
import { checkLedgerIntegrity, postLedger } from "@/lib/services/ledger";
import {
  cancelWithdrawal,
  creditWallet,
  debitWallet,
  processWithdrawal,
  requestWithdrawal,
  settleWithdrawalTransfer,
} from "@/lib/services/wallet";
import { settleOrderTransfer, updateOrderStatus } from "@/lib/services/desk";
import { balanceOf, makeAdmin, makeCustomer, makeSellOrder, settle, TEST_PIN } from "../helpers/fixtures";

const ctx = { ip: "127.0.0.1" };
const balanceOfAccount = async (code: string) => (await prisma.ledgerAccount.findUniqueOrThrow({ where: { code } })).balance;
const entriesOf = (reference: string) =>
  prisma.ledgerEntry.findMany({
    where: { transaction: { reference } },
    select: { direction: true, amount: true, account: { select: { code: true } } },
    orderBy: { amount: "desc" },
  });
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

beforeEach(() => {
  paystack.payoutToBank.mockReset();
  paystack.verifyTransfer.mockReset();
});

describe("ledger rules enforced by the database", () => {
  it("refuses a transaction whose debits and credits differ", async () => {
    const user = await makeCustomer({ balanceNgn: 1_000 });
    const [customer, clearing] = await Promise.all([
      prisma.ledgerAccount.findUniqueOrThrow({ where: { code: customerAccountCode(user.id) } }),
      prisma.ledgerAccount.findUniqueOrThrow({ where: { code: SYSTEM_ACCOUNTS.providerClearing } }),
    ]);
    const reference = `bad:unbalanced-${uniq()}`;

    await expect(
      prisma.ledgerTransaction.create({
        data: {
          reference,
          kind: "deposit",
          description: "Unbalanced on purpose",
          entries: {
            create: [
              { accountId: clearing.id, direction: "DEBIT", amount: 500 },
              { accountId: customer.id, direction: "CREDIT", amount: 499.99 },
            ],
          },
        },
      }),
    ).rejects.toThrow(); // refused when the database transaction tries to commit

    // Nothing was kept: no transaction, no entries, no balance change.
    expect(await prisma.ledgerTransaction.count({ where: { reference } })).toBe(0);
    expect(await balanceOf(user.id)).toBe(1_000);
  });

  it("refuses a transaction with no entries", async () => {
    await expect(
      prisma.ledgerTransaction.create({ data: { reference: `bad:empty-${uniq()}`, kind: "deposit", description: "No entries" } }),
    ).rejects.toThrow(/does not balance/);
  });

  it("never lets a posted entry or transaction be edited or deleted", async () => {
    const user = await makeCustomer({ balanceNgn: 1_000 });
    const tx = await prisma.ledgerTransaction.findUniqueOrThrow({
      where: { reference: `test-open:${user.id}` },
      include: { entries: true },
    });

    await expect(prisma.ledgerEntry.update({ where: { id: tx.entries[0].id }, data: { amount: 5 } })).rejects.toThrow(/immutable/);
    await expect(prisma.ledgerEntry.delete({ where: { id: tx.entries[0].id } })).rejects.toThrow(/immutable/);
    await expect(prisma.ledgerTransaction.update({ where: { id: tx.id }, data: { description: "edited" } })).rejects.toThrow(/immutable/);
    await expect(prisma.ledgerTransaction.delete({ where: { id: tx.id } })).rejects.toThrow();
    expect(await balanceOf(user.id)).toBe(1_000);
  });

  it("never lets entries be added to a transaction that is already posted", async () => {
    const user = await makeCustomer({ balanceNgn: 1_000 });
    const tx = await prisma.ledgerTransaction.findUniqueOrThrow({ where: { reference: `test-open:${user.id}` }, include: { entries: true } });
    // A balanced pair, so only the "same transaction" rule can stop it.
    await expect(
      prisma.ledgerEntry.createMany({
        data: [
          { transactionId: tx.id, accountId: tx.entries[0].accountId, direction: "DEBIT", amount: 10 },
          { transactionId: tx.id, accountId: tx.entries[1].accountId, direction: "CREDIT", amount: 10 },
        ],
      }),
    ).rejects.toThrow(/posted together/);
  });

  it("never lets a balance be set by hand, on the account or on the user", async () => {
    const user = await makeCustomer({ balanceNgn: 1_000 });
    const account = await prisma.ledgerAccount.findUniqueOrThrow({ where: { code: customerAccountCode(user.id) } });

    await expect(prisma.ledgerAccount.update({ where: { id: account.id }, data: { balance: 9_999_999 } })).rejects.toThrow(/only through ledger entries/);
    await expect(prisma.user.update({ where: { id: user.id }, data: { walletBalanceNgn: 9_999_999 } })).rejects.toThrow(/derived from the ledger/);
    await expect(prisma.user.update({ where: { id: user.id }, data: { walletBalanceNgn: { increment: 1 } } })).rejects.toThrow(/derived from the ledger/);
    expect(await balanceOf(user.id)).toBe(1_000);
  });

  it("never lets a customer account go negative, even bypassing the wallet service", async () => {
    const user = await makeCustomer({ balanceNgn: 100 });
    await expect(
      postLedger(prisma, {
        reference: `bad:overdraw-${uniq()}`,
        kind: "purchase",
        description: "Overdraw on purpose",
        lines: [
          { account: customerAccountCode(user.id), direction: "DEBIT", amount: 100.01 },
          { account: SYSTEM_ACCOUNTS.tradingSettlement, direction: "CREDIT", amount: 100.01 },
        ],
      }),
    ).rejects.toThrow();
    expect(await balanceOf(user.id)).toBe(100);
  });
});

describe("ledger postings", () => {
  it("rejects lines that do not balance before touching the database", async () => {
    await expect(
      postLedger(prisma, {
        reference: `bad:lines-${uniq()}`,
        kind: "deposit",
        description: "x",
        lines: [
          { account: SYSTEM_ACCOUNTS.providerClearing, direction: "DEBIT", amount: 10 },
          { account: SYSTEM_ACCOUNTS.feeRevenue, direction: "CREDIT", amount: 9 },
        ],
      }),
    ).rejects.toThrow(/do not equal/);
  });

  it("posts a deposit as provider clearing against the customer, once per reference", async () => {
    const user = await makeCustomer();
    const reference = `fund:${uniq()}`;
    const deposit = () =>
      prisma.$transaction((tx) => creditWallet(tx, { userId: user.id, amountNgn: 2_500, reference, description: "Top-up", kind: "deposit" }));

    expect(await deposit()).toBe(true);
    expect(await deposit()).toBe(false);

    const entries = await entriesOf(reference);
    expect(entries.map((e) => [e.account.code, e.direction, e.amount]).sort()).toEqual(
      [
        [SYSTEM_ACCOUNTS.providerClearing, "DEBIT", 2_500],
        [customerAccountCode(user.id), "CREDIT", 2_500],
      ].sort(),
    );
    expect(await balanceOfAccount(customerAccountCode(user.id))).toBe(2_500);
    expect(await balanceOf(user.id)).toBe(2_500);
  });

  it("keeps the user's balance equal to the ledger account through every movement", async () => {
    const user = await makeCustomer({ balanceNgn: 10_000 });
    const code = customerAccountCode(user.id);
    const step = async () => expect(await balanceOf(user.id)).toBe(await balanceOfAccount(code));

    await prisma.$transaction((tx) => debitWallet(tx, { userId: user.id, amountNgn: 3_333.33, reference: `buy:${uniq()}`, description: "Buy", kind: "purchase" }));
    await step();
    await prisma.$transaction((tx) => creditWallet(tx, { userId: user.id, amountNgn: 0.01, reference: `order:${uniq()}`, description: "Sale", kind: "sale_proceeds" }));
    await step();
    expect(await balanceOf(user.id)).toBe(6_666.68);
  });

  it("holds a withdrawal in payout clearing, then books the fee as revenue when it is paid", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer({ balanceNgn: 10_000 });
    const clearingBefore = await balanceOfAccount(SYSTEM_ACCOUNTS.payoutClearing);
    const feesBefore = await balanceOfAccount(SYSTEM_ACCOUNTS.feeRevenue);
    const providerBefore = await balanceOfAccount(SYSTEM_ACCOUNTS.providerClearing);

    expect((await requestWithdrawal(user, { amountNgn: 5_000, pin: TEST_PIN }, ctx)).ok).toBe(true);
    const w = await prisma.withdrawal.findFirstOrThrow({ where: { userId: user.id } });
    // Requested: the customer is owed 5,050 less; it sits in payout clearing. No revenue yet.
    expect(await balanceOf(user.id)).toBe(4_950);
    expect(await balanceOfAccount(SYSTEM_ACCOUNTS.payoutClearing)).toBe(clearingBefore + 5_050);
    expect(await balanceOfAccount(SYSTEM_ACCOUNTS.feeRevenue)).toBe(feesBefore);

    paystack.payoutToBank.mockResolvedValue({ ok: true, payoutRef: "TRF_ledger", status: "pending" });
    await processWithdrawal(admin, { id: w.id, action: "paystack" });
    await settleWithdrawalTransfer("TRF_ledger", true);
    // A repeated webhook must not post the paid leg twice.
    await settleWithdrawalTransfer("TRF_ledger", true);

    expect(await balanceOfAccount(SYSTEM_ACCOUNTS.payoutClearing)).toBe(clearingBefore);
    expect(await balanceOfAccount(SYSTEM_ACCOUNTS.feeRevenue)).toBe(feesBefore + 50);
    expect(await balanceOfAccount(SYSTEM_ACCOUNTS.providerClearing)).toBe(providerBefore - 5_000);
    expect(await prisma.ledgerTransaction.count({ where: { reference: `wd-paid:${w.reference}` } })).toBe(1);
    await settle();
  });

  it("books a hand-paid withdrawal against the bank account", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer({ balanceNgn: 10_000 });
    const bankBefore = await balanceOfAccount(SYSTEM_ACCOUNTS.bank);
    await requestWithdrawal(user, { amountNgn: 2_000, pin: TEST_PIN }, ctx);
    const w = await prisma.withdrawal.findFirstOrThrow({ where: { userId: user.id } });

    expect((await processWithdrawal(admin, { id: w.id, action: "mark-paid", payoutRef: "GTB-123456" })).ok).toBe(true);
    expect(await balanceOfAccount(SYSTEM_ACCOUNTS.bank)).toBe(bankBefore - 2_000);
    await settle();
  });

  it("records a refund as a reversal linked to the withdrawal it undoes", async () => {
    const user = await makeCustomer({ balanceNgn: 10_000 });
    const clearingBefore = await balanceOfAccount(SYSTEM_ACCOUNTS.payoutClearing);
    await requestWithdrawal(user, { amountNgn: 5_000, pin: TEST_PIN }, ctx);
    const w = await prisma.withdrawal.findFirstOrThrow({ where: { userId: user.id } });
    await cancelWithdrawal(user, { id: w.id });

    const original = await prisma.ledgerTransaction.findUniqueOrThrow({ where: { reference: `wd:${w.reference}` } });
    const refund = await prisma.ledgerTransaction.findUniqueOrThrow({ where: { reference: `wd-refund:${w.reference}` } });
    expect(refund.reversesId).toBe(original.id);
    expect(refund.kind).toBe("withdrawal_refund");
    // The original is still there, untouched: history is corrected by adding, never by editing.
    expect(await prisma.ledgerEntry.count({ where: { transactionId: original.id } })).toBe(2);
    expect(await balanceOf(user.id)).toBe(10_000);
    expect(await balanceOfAccount(SYSTEM_ACCOUNTS.payoutClearing)).toBe(clearingBefore);
    await settle();
  });
});

describe("ledger integrity check", () => {
  it("finds nothing wrong after a mix of real movements, and the books balance", async () => {
    const admin = await makeAdmin();
    const a = await makeCustomer({ balanceNgn: 50_000 });
    const b = await makeCustomer();
    await prisma.$transaction((tx) => creditWallet(tx, { userId: b.id, amountNgn: 7_500.5, reference: `fund:${uniq()}`, description: "Top-up", kind: "deposit" }));
    await prisma.$transaction((tx) => debitWallet(tx, { userId: a.id, amountNgn: 12_345.67, reference: `buy:${uniq()}`, description: "Buy", kind: "purchase" }));
    await prisma.$transaction((tx) => creditWallet(tx, { userId: a.id, amountNgn: 1_000, reference: `referral:${uniq()}`, description: "Bonus", kind: "referral_bonus" }));
    await requestWithdrawal(a, { amountNgn: 5_000, pin: TEST_PIN }, ctx);
    const w = await prisma.withdrawal.findFirstOrThrow({ where: { userId: a.id } });
    await processWithdrawal(admin, { id: w.id, action: "mark-paid", payoutRef: "GTB-999" });

    const report = await checkLedgerIntegrity();
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.transactions).toBeGreaterThanOrEqual(6);
    await settle();
  });
});

describe("orders settled outside the wallet", () => {
  const settlement = (reference: string) => entriesOf(`order-settled:${reference}`);

  it("posts a sale paid by bank transfer when the desk completes it, once", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const order = await makeSellOrder(user.id, { amountNgn: 150_000, payoutMethod: "BANK" });

    expect((await updateOrderStatus(admin, "crypto", { id: order.id, status: "COMPLETED", payoutRef: "GTB-777" })).ok).toBe(true);
    await updateOrderStatus(admin, "crypto", { id: order.id, status: "COMPLETED", adminNote: "note only" });

    const entries = await settlement(order.reference);
    expect(entries.map((e) => [e.account.code, e.direction, e.amount]).sort()).toEqual(
      [
        [SYSTEM_ACCOUNTS.tradingSettlement, "DEBIT", 150_000],
        [SYSTEM_ACCOUNTS.bank, "CREDIT", 150_000],
      ].sort(),
    );
    // The customer's wallet is not involved.
    expect(await balanceOf(user.id)).toBe(0);
    await settle();
  });

  it("posts a Paystack payout against provider clearing when the transfer is confirmed", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const order = await makeSellOrder(user.id, { amountNgn: 80_000, payoutMethod: "BANK" });
    paystack.payoutToBank.mockResolvedValue({ ok: true, payoutRef: "TRF_settle", status: "pending" });
    await updateOrderStatus(admin, "crypto", { id: order.id, status: "APPROVED", triggerPayout: true });
    // Payout sent but not confirmed: nothing in the ledger yet.
    expect(await settlement(order.reference)).toHaveLength(0);

    const evt = { transferCode: "TRF_settle", success: true, event: "transfer.success" };
    await settleOrderTransfer(evt);
    await settleOrderTransfer(evt);

    const entries = await settlement(order.reference);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.direction === "CREDIT")?.account.code).toBe(SYSTEM_ACCOUNTS.providerClearing);
    await settle();
  });

  it("does not post a second time for a sale already paid into the wallet", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const order = await makeSellOrder(user.id, { amountNgn: 40_000, payoutMethod: "WALLET" });
    await updateOrderStatus(admin, "crypto", { id: order.id, status: "COMPLETED" });

    expect(await settlement(order.reference)).toHaveLength(0);
    expect(await entriesOf(`order:${order.reference}`)).toHaveLength(2);
    expect(await balanceOf(user.id)).toBe(40_000);
    await settle();
  });

  it("posts a purchase paid by bank transfer as money received at the bank", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const order = await prisma.cryptoOrder.create({
      data: {
        reference: `NXB-${uniq().toUpperCase()}`,
        userId: user.id,
        symbol: "USDT",
        network: "TRC20",
        side: "BUY",
        amountCrypto: 10,
        rateNgn: 1_520,
        amountNgn: 15_200,
        paymentRef: "GTB-PAYIN-1",
        status: "UNDER_REVIEW",
      },
    });
    expect((await updateOrderStatus(admin, "crypto", { id: order.id, status: "COMPLETED" })).ok).toBe(true);

    const entries = await settlement(order.reference);
    expect(entries.map((e) => [e.account.code, e.direction, e.amount]).sort()).toEqual(
      [
        [SYSTEM_ACCOUNTS.bank, "DEBIT", 15_200],
        [SYSTEM_ACCOUNTS.tradingSettlement, "CREDIT", 15_200],
      ].sort(),
    );
    const report = await checkLedgerIntegrity();
    expect(report.problems).toEqual([]);
    await settle();
  });
});
