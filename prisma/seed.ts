import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@nexora.ng";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMeAdmin!2026";
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: "ADMIN", passwordHash },
    create: {
      email: adminEmail,
      phone: "08000000000",
      fullName: "Nexora Admin",
      role: "ADMIN",
      passwordHash,
      kyc: {
        create: {
          status: "APPROVED",
          bankName: "Nexora Treasury",
          accountNumber: "0000000000",
          accountName: "Nexora Limited",
          submittedAt: new Date(),
          reviewedAt: new Date(),
        },
      },
    },
  });

  const rates = [
    {
      kind: "CRYPTO" as const,
      symbol: "USDT",
      displayName: "Tether (USDT)",
      sellRateNgn: 1380,
      buyRateNgn: 1400,
      minAmount: 10,
      maxAmount: 50000,
      sortOrder: 1,
    },
    {
      kind: "CRYPTO" as const,
      symbol: "BTC",
      displayName: "Bitcoin (BTC)",
      sellRateNgn: 89_100_000,
      buyRateNgn: 90_400_000,
      minAmount: 0.0001,
      maxAmount: 5,
      sortOrder: 2,
    },
    {
      kind: "CRYPTO" as const,
      symbol: "ETH",
      displayName: "Ethereum (ETH)",
      sellRateNgn: 2_590_000,
      buyRateNgn: 2_640_000,
      minAmount: 0.01,
      maxAmount: 100,
      sortOrder: 3,
    },
    // Gift cards are per $1 face value (desk payout), kept under USDT mid (~1380)
    {
      kind: "GIFTCARD" as const,
      symbol: "APPLE",
      displayName: "Apple Gift Card",
      sellRateNgn: 1210,
      buyRateNgn: 0,
      minAmount: 25,
      maxAmount: 2000,
      sortOrder: 10,
    },
    {
      kind: "GIFTCARD" as const,
      symbol: "STEAM",
      displayName: "Steam Gift Card",
      sellRateNgn: 950,
      buyRateNgn: 0,
      minAmount: 10,
      maxAmount: 500,
      sortOrder: 11,
    },
    {
      kind: "GIFTCARD" as const,
      symbol: "AMAZON",
      displayName: "Amazon Gift Card",
      sellRateNgn: 1240,
      buyRateNgn: 0,
      minAmount: 25,
      maxAmount: 1000,
      sortOrder: 12,
    },
    {
      kind: "GIFTCARD" as const,
      symbol: "GOOGLE",
      displayName: "Google Play",
      sellRateNgn: 1100,
      buyRateNgn: 0,
      minAmount: 10,
      maxAmount: 500,
      sortOrder: 13,
    },
  ];

  for (const rate of rates) {
    await prisma.rate.upsert({
      where: { kind_symbol: { kind: rate.kind, symbol: rate.symbol } },
      update: {
        displayName: rate.displayName,
        sellRateNgn: rate.sellRateNgn,
        buyRateNgn: rate.buyRateNgn,
        minAmount: rate.minAmount,
        maxAmount: rate.maxAmount,
        isActive: true,
        sortOrder: rate.sortOrder,
      },
      create: rate,
    });
  }

  await prisma.platformWallet.upsert({
    where: { symbol: "USDT" },
    update: {
      network: "TRC20",
      address: "TNexoraDemoUSDTAddressReplaceMe111",
      isActive: true,
      note: "Replace with your live TRC20 USDT wallet before going live",
    },
    create: {
      symbol: "USDT",
      network: "TRC20",
      address: "TNexoraDemoUSDTAddressReplaceMe111",
      note: "Replace with your live TRC20 USDT wallet before going live",
    },
  });

  await prisma.platformWallet.upsert({
    where: { symbol: "BTC" },
    update: {
      network: "BTC",
      address: "bc1qnexorademobtcaddressreplaceme000",
      isActive: true,
    },
    create: {
      symbol: "BTC",
      network: "BTC",
      address: "bc1qnexorademobtcaddressreplaceme000",
    },
  });

  await prisma.platformWallet.upsert({
    where: { symbol: "ETH" },
    update: {
      network: "ERC20",
      address: "0xNexoraDemoETHAddressReplaceMe00000000",
      isActive: true,
    },
    create: {
      symbol: "ETH",
      network: "ERC20",
      address: "0xNexoraDemoETHAddressReplaceMe00000000",
    },
  });

  console.log("Seed complete.");
  console.log(`Admin: ${adminEmail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
