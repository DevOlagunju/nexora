/**
 * One-time copy of an old SQLite database into Postgres.
 *
 *   npx tsx scripts/sqlite-to-postgres.mts [path/to/old.db]      (default: prisma/dev.db)
 *
 * Reads the SQLite file directly (read-only) and writes through the app's Prisma client to
 * DATABASE_URL. Refuses to run if the target already has users. Money is rounded to the
 * column's scale on the way in, which removes any float noise SQLite was holding.
 * Keep ENCRYPTION_KEY unchanged or copied gift-card codes cannot be decrypted.
 */
import "dotenv/config";
import path from "node:path";
import Database from "better-sqlite3";
import { createPrismaClient } from "../src/lib/prisma-factory";

const source = path.resolve(process.argv[2] ?? "prisma/dev.db");
const sqlite = new Database(source, { readonly: true, fileMustExist: true });
const prisma = createPrismaClient();

const DATES = new Set([
  "createdAt", "updatedAt", "expiresAt", "usedAt", "submittedAt", "reviewedAt", "completedAt",
  "processedAt", "readAt", "triggeredAt", "paidAt", "pinLockedUntil",
]);
const BOOLS = new Set(["accountVerified", "nameMatch", "isActive", "fraudFlag"]);
/** Decimal places per money column (matches prisma/schema.prisma). */
const SCALE: Record<string, number> = {
  walletBalanceNgn: 2, amountNgn: 2, feeNgn: 2, paidNgn: 2, faceValueUsd: 2,
  sellRateNgn: 4, buyRateNgn: 4, rateNgn: 4, targetNgn: 4,
  amountCrypto: 18, minAmount: 18, maxAmount: 18,
};

/** A float as the decimal a person would write (0.1, not 0.1000000000000000055), cut to the column scale. */
function decimalText(value: number, scale: number): string {
  if (scale <= 4) return value.toFixed(scale);
  const shortest = String(value);
  return /e/i.test(shortest) ? value.toFixed(scale).replace(/\.?0+$/, "") : shortest;
}

function convert(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) out[key] = null;
    else if (DATES.has(key)) out[key] = new Date(value as string | number);
    else if (BOOLS.has(key)) out[key] = Boolean(value);
    else if (key in SCALE) out[key] = decimalText(Number(value), SCALE[key]);
    else out[key] = value;
  }
  return out;
}

const rows = (table: string) => (sqlite.prepare(`select * from "${table}"`).all() as Record<string, unknown>[]).map(convert);

// Parents before children.
const TABLES = [
  ["User", prisma.user],
  ["KycProfile", prisma.kycProfile],
  ["Session", prisma.session],
  ["PasswordResetToken", prisma.passwordResetToken],
  ["Rate", prisma.rate],
  ["PlatformWallet", prisma.platformWallet],
  ["CryptoOrder", prisma.cryptoOrder],
  ["GiftCardOrder", prisma.giftCardOrder],
  ["AuditLog", prisma.auditLog],
  ["WalletEntry", prisma.walletEntry],
  ["Withdrawal", prisma.withdrawal],
  ["Notification", prisma.notification],
  ["RateAlert", prisma.rateAlert],
  ["Payment", prisma.payment],
] as const;

if ((await prisma.user.count()) > 0) {
  console.error("Target database already has users. Refusing to copy on top of existing data.");
  process.exit(1);
}

let failed = false;
await prisma.$transaction(
  async (tx) => {
    for (const [table] of TABLES) {
      const data = rows(table);
      // Users can refer to each other: insert them first, link referrals afterwards.
      const referrals = table === "User" ? data.filter((r) => r.referredById).map((r) => [r.id, r.referredById] as const) : [];
      if (table === "User") for (const r of data) r.referredById = null;
      const delegate = tx[(table[0].toLowerCase() + table.slice(1)) as "user"] as unknown as {
        createMany(args: { data: unknown[] }): Promise<{ count: number }>;
      };
      const { count } = data.length ? await delegate.createMany({ data }) : { count: 0 };
      for (const [id, referredById] of referrals) {
        await tx.user.update({ where: { id: id as string }, data: { referredById: referredById as string } });
      }
      const ok = count === data.length;
      failed ||= !ok;
      console.log(`${ok ? "ok " : "BAD"} ${table.padEnd(20)} ${count}/${data.length}`);
    }
    if (failed) throw new Error("Row counts differ; nothing was copied.");
  },
  { timeout: 120_000 },
);

// Cross-check the money that matters: every wallet balance, old against new.
const before = sqlite.prepare('select id, walletBalanceNgn from "User"').all() as { id: string; walletBalanceNgn: number }[];
const after = new Map((await prisma.user.findMany({ select: { id: true, walletBalanceNgn: true } })).map((u) => [u.id, u.walletBalanceNgn]));
let mismatched = 0;
for (const u of before) {
  if (Number(u.walletBalanceNgn.toFixed(2)) !== after.get(u.id)) {
    mismatched++;
    console.error(`balance mismatch for ${u.id}: ${u.walletBalanceNgn} -> ${after.get(u.id)}`);
  }
}
console.log(mismatched ? `${mismatched} wallet balances differ` : `all ${before.length} wallet balances match`);
process.exit(mismatched ? 1 : 0);
