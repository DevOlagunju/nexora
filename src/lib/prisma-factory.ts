import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client";

/**
 * Builds the Prisma client (PostgreSQL only; see docs/POSTGRES.md).
 * Uses relative imports so scripts run via tsx (seed, admin tools) can share it.
 *
 * Money strategy: every amount is an exact DECIMAL column, and balance arithmetic
 * happens in SQL (increment / decrement / conditional update), so the database is
 * the financial source of truth and never holds a binary float.
 * On read, amounts are handed to the app as plain numbers so the JSON API and the UI
 * keep their existing shape. A stored amount has at most 15 significant digits here,
 * so that conversion is exact. Arithmetic on amounts in app code goes through
 * src/lib/money.ts (decimal math), not through `+` and `*`.
 */
export function isPostgresUrl(url: string) {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

type Dec = Prisma.Decimal;
const n = (v: Dec) => v.toNumber();
const nOrNull = (v: Dec | null) => (v === null ? null : v.toNumber());

export function createPrismaClient(url = process.env.DATABASE_URL ?? "") {
  if (!isPostgresUrl(url)) {
    throw new Error(
      "DATABASE_URL must be a postgresql:// URL. Start the local database with `docker compose up -d postgres` (docs/POSTGRES.md).",
    );
  }
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
  });
  return new PrismaClient({ adapter: new PrismaPg(pool) }).$extends({
    name: "money-as-number",
    result: {
      user: {
        walletBalanceNgn: { needs: { walletBalanceNgn: true }, compute: (r) => n(r.walletBalanceNgn) },
      },
      rate: {
        sellRateNgn: { needs: { sellRateNgn: true }, compute: (r) => n(r.sellRateNgn) },
        buyRateNgn: { needs: { buyRateNgn: true }, compute: (r) => n(r.buyRateNgn) },
        minAmount: { needs: { minAmount: true }, compute: (r) => n(r.minAmount) },
        maxAmount: { needs: { maxAmount: true }, compute: (r) => nOrNull(r.maxAmount) },
      },
      cryptoOrder: {
        amountCrypto: { needs: { amountCrypto: true }, compute: (r) => n(r.amountCrypto) },
        rateNgn: { needs: { rateNgn: true }, compute: (r) => n(r.rateNgn) },
        amountNgn: { needs: { amountNgn: true }, compute: (r) => n(r.amountNgn) },
      },
      giftCardOrder: {
        faceValueUsd: { needs: { faceValueUsd: true }, compute: (r) => n(r.faceValueUsd) },
        rateNgn: { needs: { rateNgn: true }, compute: (r) => n(r.rateNgn) },
        amountNgn: { needs: { amountNgn: true }, compute: (r) => n(r.amountNgn) },
      },
      walletEntry: {
        amountNgn: { needs: { amountNgn: true }, compute: (r) => n(r.amountNgn) },
      },
      withdrawal: {
        amountNgn: { needs: { amountNgn: true }, compute: (r) => n(r.amountNgn) },
        feeNgn: { needs: { feeNgn: true }, compute: (r) => n(r.feeNgn) },
      },
      rateAlert: {
        targetNgn: { needs: { targetNgn: true }, compute: (r) => n(r.targetNgn) },
      },
      quote: {
        amount: { needs: { amount: true }, compute: (r) => n(r.amount) },
        rateNgn: { needs: { rateNgn: true }, compute: (r) => n(r.rateNgn) },
        feeNgn: { needs: { feeNgn: true }, compute: (r) => n(r.feeNgn) },
        amountNgn: { needs: { amountNgn: true }, compute: (r) => n(r.amountNgn) },
      },
      giftCardRate: {
        rateNgn: { needs: { rateNgn: true }, compute: (r) => n(r.rateNgn) },
        minFaceUsd: { needs: { minFaceUsd: true }, compute: (r) => n(r.minFaceUsd) },
        maxFaceUsd: { needs: { maxFaceUsd: true }, compute: (r) => nOrNull(r.maxFaceUsd) },
      },
      ledgerAccount: {
        balance: { needs: { balance: true }, compute: (r) => n(r.balance) },
      },
      ledgerEntry: {
        amount: { needs: { amount: true }, compute: (r) => n(r.amount) },
      },
      payment: {
        amountNgn: { needs: { amountNgn: true }, compute: (r) => n(r.amountNgn) },
        paidNgn: { needs: { paidNgn: true }, compute: (r) => nOrNull(r.paidNgn) },
      },
    },
  });
}

export type AppPrismaClient = ReturnType<typeof createPrismaClient>;
/** The client handed to a `prisma.$transaction(async (tx) => ...)` callback. */
export type Db = Parameters<Parameters<AppPrismaClient["$transaction"]>[0]>[0];
