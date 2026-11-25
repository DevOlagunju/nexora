import "dotenv/config";
import bcrypt from "bcryptjs";
import { createPrismaClient } from "../src/lib/prisma-factory";

// Uses the same Postgres DATABASE_URL the app uses.
const prisma = createPrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@nexora.ng";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMeAdmin!2026";
  if (process.env.NODE_ENV === "production" && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD before seeding production.");
  }
  if (process.env.NODE_ENV === "production" && (adminPassword.length < 12 || adminPassword === "ChangeMeAdmin!2026")) {
    throw new Error("ADMIN_PASSWORD must be at least 12 chars and not the example value.");
  }
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: "ADMIN", passwordHash },
    create: {
      email: adminEmail,
      phone: "08000000000",
      fullName: "Nexora Admin",
      role: "ADMIN",
      // The bootstrap admin runs everything; give other staff narrower roles (npm run admin:role).
      staffRole: "SUPER_ADMIN",
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

  // Each asset's default network and deposit address. The networks themselves are created by
  // the asset_network_registry migration. These addresses are placeholders: replace them on
  // the admin desk (Assets and networks) before going live; the desk checks the format.
  const placeholders = [
    { symbol: "USDT", network: "TRC20", address: "TNexoraDemoUSDTAddressReplaceMe111", note: "Replace with your live TRC20 USDT wallet before going live" },
    { symbol: "BTC", network: "BTC", address: "bc1qnexorademobtcaddressreplaceme000", note: null },
    { symbol: "ETH", network: "ERC20", address: "0xNexoraDemoETHAddressReplaceMe00000000", note: null },
  ];
  for (const p of placeholders) {
    const network = await prisma.blockchainNetwork.findUniqueOrThrow({ where: { code: p.network } });
    await prisma.assetNetwork.upsert({
      where: { symbol_networkId: { symbol: p.symbol, networkId: network.id } },
      // Never overwrite an address someone has already set.
      update: {},
      create: {
        symbol: p.symbol,
        networkId: network.id,
        depositAddress: p.address,
        confirmations: network.defaultConfirmations,
        isDefault: (await prisma.assetNetwork.count({ where: { symbol: p.symbol, isDefault: true } })) === 0,
        note: p.note,
      },
    });
  }

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
