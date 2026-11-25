/**
 * Local demo customers for reviewing the dashboard. NEVER run against production.
 *   npx tsx scripts/seed-demo.ts            create / refresh
 *   npx tsx scripts/seed-demo.ts --remove   delete demo users and their orders
 * Logins: demo@nexora.local / pending@nexora.local, password DemoPass2026 (demo transaction PIN 2580)
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../src/lib/prisma-factory";
import { encryptSecret, orderReference } from "../src/lib/crypto";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo users in production.");

const prisma = createPrismaClient();
const DEMO = "demo@nexora.local";
const PENDING = "pending@nexora.local";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

async function freePhone(start: number) {
  const taken = new Set((await prisma.user.findMany({ select: { phone: true } })).map((u) => u.phone));
  for (let n = start; ; n++) {
    const p = `0809${String(n).padStart(7, "0")}`;
    if (!taken.has(p)) return p;
  }
}

async function main() {
  await prisma.user.deleteMany({ where: { email: { in: [DEMO, PENDING] } } });
  if (process.argv.includes("--remove")) {
    console.log("Demo users removed.");
    return;
  }

  const passwordHash = await bcrypt.hash("DemoPass2026", 12);
  // Each asset's default network and deposit address, from the registry.
  const wallets = Object.fromEntries(
    (await prisma.assetNetwork.findMany({ where: { isDefault: true }, include: { network: true } })).map((w) => [
      w.symbol,
      { network: w.network.code, address: w.depositAddress },
    ]),
  );
  const bank = { bankName: "GTBank", accountNumber: "0123456789", accountName: "Ada Okafor" };

  const demo = await prisma.user.create({
    data: {
      email: DEMO,
      phone: await freePhone(1),
      fullName: "Ada Okafor",
      passwordHash,
      kyc: {
        create: { status: "APPROVED", bvnLast4: "4821", ninLast4: "7730", ...bank, submittedAt: hoursAgo(200), reviewedAt: hoursAgo(198) },
      },
    },
  });

  const crypto = (o: {
    side: "SELL" | "BUY";
    symbol: string;
    amountCrypto: number;
    rateNgn: number;
    status: "AWAITING_DEPOSIT" | "UNDER_REVIEW" | "APPROVED" | "PAYOUT_SENT" | "COMPLETED" | "REJECTED";
    h: number;
    adminNote?: string;
  }) =>
    prisma.cryptoOrder.create({
      data: {
        reference: orderReference(o.side === "SELL" ? "NXC" : "NXB"),
        userId: demo.id,
        symbol: o.symbol,
        network: wallets[o.symbol]?.network ?? "TRC20",
        side: o.side,
        amountCrypto: o.amountCrypto,
        rateNgn: o.rateNgn,
        amountNgn: Math.round(o.amountCrypto * o.rateNgn * 100) / 100,
        depositAddress: o.side === "SELL" ? wallets[o.symbol]?.address : null,
        userReceiveAddress: o.side === "BUY" ? "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE" : null,
        txHash: o.side === "SELL" && o.status !== "AWAITING_DEPOSIT" ? "0x9f3c1a77be0d5a2e44c1" : null,
        paymentRef: o.side === "BUY" && o.status !== "AWAITING_DEPOSIT" ? "GTB-TRF-88213" : null,
        ...(o.side === "SELL" ? bank : { bankName: "Nexora Desk", accountNumber: "0000000000", accountName: "Nexora Limited" }),
        status: o.status,
        adminNote: o.adminNote,
        payoutRef: o.status === "PAYOUT_SENT" || o.status === "COMPLETED" ? "TRF_demo" : null,
        completedAt: o.status === "COMPLETED" || o.status === "PAYOUT_SENT" ? hoursAgo(o.h - 1) : null,
        createdAt: hoursAgo(o.h),
      },
    });

  await crypto({ side: "SELL", symbol: "USDT", amountCrypto: 250, rateNgn: 1379, status: "AWAITING_DEPOSIT", h: 0.3 });
  await crypto({ side: "BUY", symbol: "USDT", amountCrypto: 80, rateNgn: 1399, status: "AWAITING_DEPOSIT", h: 1.2 });
  await crypto({ side: "SELL", symbol: "BTC", amountCrypto: 0.012, rateNgn: 89_286_113, status: "UNDER_REVIEW", h: 3 });
  await crypto({ side: "SELL", symbol: "USDT", amountCrypto: 500, rateNgn: 1375, status: "PAYOUT_SENT", h: 20 });
  await crypto({ side: "SELL", symbol: "ETH", amountCrypto: 0.4, rateNgn: 2_590_000, status: "COMPLETED", h: 70 });
  await crypto({ side: "BUY", symbol: "USDT", amountCrypto: 150, rateNgn: 1401, status: "COMPLETED", h: 96 });
  await crypto({
    side: "SELL",
    symbol: "USDT",
    amountCrypto: 40,
    rateNgn: 1370,
    status: "REJECTED",
    h: 140,
    adminNote: "Deposit arrived on BEP20, not TRC20. Contact support to recover.",
  });

  const sealed = encryptSecret("DEMO-AAAA-BBBB-CCCC");
  const gift = (brand: string, face: number, rate: number, status: "UNDER_REVIEW" | "APPROVED" | "COMPLETED", h: number) =>
    prisma.giftCardOrder.create({
      data: {
        reference: orderReference("NXG"),
        userId: demo.id,
        brand,
        country: "US",
        faceValueUsd: face,
        rateNgn: rate,
        amountNgn: face * rate,
        cardCodeEncrypted: sealed.ciphertext,
        cardCodeIv: sealed.iv,
        ...bank,
        status,
        completedAt: status === "COMPLETED" ? hoursAgo(h - 2) : null,
        createdAt: hoursAgo(h),
      },
    });
  await gift("APPLE", 100, 1210, "APPROVED", 5);
  await gift("AMAZON", 50, 1240, "COMPLETED", 120);

  // Wallet: one sale credited to the wallet, one withdrawal paid, one waiting at the desk.
  // Balance below is exactly credits - debits so the ledger reconciles.
  const credit = 0.4 * 2_590_000;
  const paidOut = 300_000 + 50;
  const waiting = 150_000 + 50;
  // Balances come from the ledger, so demo money is posted as balanced transactions
  // (customer account on one side, a system account on the other), like real movements.
  const customer = `customer:${demo.id}:NGN`;
  await prisma.ledgerAccount.upsert({
    where: { code: customer },
    update: {},
    create: { code: customer, name: "Customer wallet", type: "LIABILITY", currency: "NGN", userId: demo.id },
  });
  const accountId = async (code: string) => (await prisma.ledgerAccount.findUniqueOrThrow({ where: { code } })).id;
  const post = async (
    reference: string,
    kind: string,
    description: string,
    at: Date,
    lines: Array<[code: string, direction: "DEBIT" | "CREDIT", amount: number]>,
  ) =>
    prisma.ledgerTransaction.create({
      data: {
        reference,
        kind,
        description,
        source: "seed-demo",
        postedAt: at,
        entries: { create: await Promise.all(lines.map(async ([code, direction, amount]) => ({ accountId: await accountId(code), direction, amount, createdAt: at }))) },
      },
    });
  await post("demo:credit-1", "sale_proceeds", "Crypto sale (demo)", hoursAgo(69), [
    [customer, "CREDIT", credit],
    ["liability:trading_settlement:NGN", "DEBIT", credit],
  ]);
  await post("demo:wd-1", "withdrawal", "Withdrawal NXW-DEMO-PAID", hoursAgo(48), [
    [customer, "DEBIT", paidOut],
    ["liability:payout_clearing:NGN", "CREDIT", paidOut],
  ]);
  await post("demo:wd-1-paid", "withdrawal_paid", "Withdrawal NXW-DEMO-PAID paid (bank transfer)", hoursAgo(47), [
    ["liability:payout_clearing:NGN", "DEBIT", paidOut],
    ["asset:bank:NGN", "CREDIT", 300_000],
    ["revenue:fees:NGN", "CREDIT", 50],
  ]);
  await post("demo:wd-2", "withdrawal", "Withdrawal NXW-DEMO-WAIT", hoursAgo(0.5), [
    [customer, "DEBIT", waiting],
    ["liability:payout_clearing:NGN", "CREDIT", waiting],
  ]);
  await prisma.walletEntry.createMany({
    data: [
      { userId: demo.id, direction: "CREDIT", amountNgn: credit, reference: "demo:credit-1", description: "Crypto sale (demo)", createdAt: hoursAgo(69) },
      { userId: demo.id, direction: "DEBIT", amountNgn: paidOut, reference: "demo:wd-1", description: "Withdrawal NXW-DEMO-PAID (₦300,000 + ₦50 fee)", createdAt: hoursAgo(48) },
      { userId: demo.id, direction: "DEBIT", amountNgn: waiting, reference: "demo:wd-2", description: "Withdrawal NXW-DEMO-WAIT (₦150,000 + ₦50 fee)", createdAt: hoursAgo(0.5) },
    ],
  });
  await prisma.withdrawal.createMany({
    data: [
      { reference: `NXW-DEMO-PAID-${demo.id.slice(-4)}`, userId: demo.id, amountNgn: 300_000, feeNgn: 50, ...bank, status: "PAID", payoutRef: "GTB-DEMO", processedAt: hoursAgo(47), createdAt: hoursAgo(48) },
      { reference: `NXW-DEMO-WAIT-${demo.id.slice(-4)}`, userId: demo.id, amountNgn: 150_000, feeNgn: 50, ...bank, createdAt: hoursAgo(0.5) },
    ],
  });
  await prisma.user.update({
    where: { id: demo.id },
    data: {
      referralCode: "NXDEMO24",
      transactionPinHash: await bcrypt.hash("2580", 10),
    },
  });
  await prisma.notification.createMany({
    data: [
      { userId: demo.id, title: "₦1,036,000 added to your wallet", body: "Your ETH sale is complete. Withdraw any time.", href: "/dashboard/wallet", createdAt: hoursAgo(69), readAt: hoursAgo(60) },
      { userId: demo.id, title: "Withdrawal ₦150,000 requested", body: "Going to GTBank ••6789.", href: "/dashboard/wallet", createdAt: hoursAgo(0.5) },
      { userId: demo.id, title: "Order approved", body: "Your Apple gift card passed verification.", href: "/dashboard/orders", createdAt: hoursAgo(4) },
    ],
  });

  await prisma.user.create({
    data: {
      email: PENDING,
      phone: await freePhone(50),
      fullName: "Tunde Bello",
      referredById: demo.id,
      passwordHash,
      kyc: { create: { status: "PENDING", bvnLast4: "1190", ninLast4: "5524", ...bank, accountName: "Tunde Bello", submittedAt: hoursAgo(1) } },
    },
  });

  console.log("Demo users ready: demo@nexora.local, pending@nexora.local (password DemoPass2026)");
}

main().finally(() => prisma.$disconnect());
