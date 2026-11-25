import { createPrismaClient, type AppPrismaClient } from "@/lib/prisma-factory";

export type { AppPrismaClient, Db } from "@/lib/prisma-factory";

// PostgreSQL via DATABASE_URL (see docs/POSTGRES.md). Money columns are exact decimals.
const globalForPrisma = globalThis as unknown as {
  prisma: AppPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Row shapes as the app sees them (amounts as numbers), for service return types. */
export type CryptoOrder = NonNullable<Awaited<ReturnType<typeof prisma.cryptoOrder.findFirst>>>;
export type GiftCardOrder = NonNullable<Awaited<ReturnType<typeof prisma.giftCardOrder.findFirst>>>;
export type Payment = NonNullable<Awaited<ReturnType<typeof prisma.payment.findFirst>>>;
export type Rate = NonNullable<Awaited<ReturnType<typeof prisma.rate.findFirst>>>;
