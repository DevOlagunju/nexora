import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

/** Rows the database tests need. Every helper makes unique rows so tests in a file do not collide. */

let seq = 0;
const next = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export const TEST_PIN = "4826";

/** A KYC-approved customer with a bank account, a transaction PIN and an opening wallet balance. */
export async function makeCustomer(opts: { balanceNgn?: number } = {}) {
  const id = next();
  const user = await prisma.user.create({
    data: {
      email: `user-${id}@example.test`,
      phone: `0803${id.slice(-7).padStart(7, "0")}${seq}`,
      passwordHash: "not-a-real-hash",
      fullName: "Ada Test",
      transactionPinHash: await bcrypt.hash(TEST_PIN, 4),
      kyc: {
        create: {
          status: "APPROVED",
          bankName: "Test Bank",
          bankCode: "999",
          accountNumber: "0123456789",
          accountName: "ADA TEST",
          accountVerified: true,
        },
      },
    },
  });
  if (opts.balanceNgn) {
    // Opening balances go through the ledger like every other credit.
    const { creditWallet } = await import("@/lib/services/wallet");
    await prisma.$transaction((tx) =>
      creditWallet(tx, {
        userId: user.id,
        amountNgn: opts.balanceNgn!,
        reference: `test-open:${user.id}`,
        kind: "adjustment",
        description: "Opening balance (test)",
      }),
    );
  }
  return { id: user.id, email: user.email };
}

export async function makeAdmin() {
  const id = next();
  const admin = await prisma.user.create({
    data: {
      email: `admin-${id}@example.test`,
      phone: `0809${id.slice(-7).padStart(7, "0")}${seq}`,
      passwordHash: "not-a-real-hash",
      fullName: "Desk Admin",
      role: "ADMIN",
    },
  });
  return { id: admin.id, email: admin.email };
}

export async function balanceOf(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalanceNgn: true } });
  return u.walletBalanceNgn;
}

/** The balance the ledger says the customer should have: credits minus debits. */
export async function ledgerBalanceOf(userId: string) {
  const entries = await prisma.walletEntry.findMany({ where: { userId }, select: { direction: true, amountNgn: true } });
  const total = entries.reduce((s, e) => s + (e.direction === "CREDIT" ? e.amountNgn : -e.amountNgn), 0);
  return Math.round(total * 100) / 100;
}

/** A sell order approved and ready for its NGN payout. */
export async function makeSellOrder(userId: string, opts: { amountNgn?: number; payoutMethod?: "BANK" | "WALLET" } = {}) {
  const id = next().toUpperCase();
  return prisma.cryptoOrder.create({
    data: {
      reference: `NXC-${id}`,
      userId,
      symbol: "USDT",
      network: "TRC20",
      side: "SELL",
      amountCrypto: 100,
      rateNgn: 1500,
      amountNgn: opts.amountNgn ?? 150_000,
      status: "APPROVED",
      payoutMethod: opts.payoutMethod ?? "BANK",
      bankName: "Test Bank",
      accountNumber: "0123456789",
      accountName: "ADA TEST",
    },
  });
}

/** Lets fire-and-forget writes (notifications, audit) finish before a test asserts or ends. */
export const settle = () => new Promise((r) => setTimeout(r, 25));
