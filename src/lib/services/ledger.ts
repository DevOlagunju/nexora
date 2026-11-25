import "server-only";
import { randomUUID } from "node:crypto";
import { prisma, type Db } from "@/lib/db";
import { customerAccountCode, inLockOrder, linesProblem, type LedgerLine } from "@/lib/ledger/accounts";

/**
 * The double-entry ledger. Every movement of customer money is posted here as one balanced
 * transaction, inside the same database transaction as the business change that caused it.
 *
 * The database enforces the rules (see the double_entry_ledger migration): transactions
 * balance, posted rows are immutable, balances change only through entries, a customer
 * balance cannot go negative. This module is the only place that writes ledger rows.
 */

type Client = Db | typeof prisma;

/** The customer's Naira account, created on first use. Safe when two requests race to create it. */
export async function ensureCustomerAccount(tx: Client, userId: string): Promise<string> {
  const code = customerAccountCode(userId);
  const found = await tx.ledgerAccount.findUnique({ where: { code }, select: { id: true } });
  if (found) return found.id;
  await tx.$executeRaw`
    INSERT INTO "LedgerAccount" ("id", "code", "name", "type", "currency", "userId")
    VALUES (${`la_${randomUUID()}`}, ${code}, 'Customer wallet', 'LIABILITY'::"LedgerAccountType", 'NGN', ${userId})
    ON CONFLICT ("code") DO NOTHING`;
  return (await tx.ledgerAccount.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
}

/**
 * Locks the customer's account for the rest of the database transaction and says whether it
 * holds at least `amountNgn`. Holding the lock is what stops two spends racing each other.
 */
export async function lockAndCheckFunds(tx: Db, accountId: string, amountNgn: number): Promise<boolean> {
  const rows = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT ("balance" >= ${amountNgn.toFixed(2)}::numeric) AS ok
    FROM "LedgerAccount" WHERE "id" = ${accountId} FOR UPDATE`;
  return rows[0]?.ok === true;
}

export type LedgerPosting = {
  /** Unique per event. Posting the same reference again does nothing. */
  reference: string;
  kind: string;
  description: string;
  /** Who or what caused it, e.g. "customer:<id>", "admin:<id>", "provider:paystack". */
  source?: string;
  /** Reference of the transaction this one reverses, when it is a reversal. */
  reverses?: string;
  lines: LedgerLine[];
};

/**
 * Posts one balanced transaction. Returns false when that reference was already posted.
 * Throws when the lines do not balance or name an account that does not exist: that is a
 * programming error, and it must abort the surrounding database transaction.
 */
export async function postLedger(tx: Client, posting: LedgerPosting): Promise<boolean> {
  const problem = linesProblem(posting.lines);
  if (problem) throw new Error(`Ledger posting ${posting.reference} rejected: ${problem}`);

  if (await tx.ledgerTransaction.findUnique({ where: { reference: posting.reference }, select: { id: true } })) {
    return false;
  }

  const lines = inLockOrder(posting.lines);
  const codes = [...new Set(lines.map((l) => l.account))];
  const accounts = await tx.ledgerAccount.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
  const idOf = new Map(accounts.map((a) => [a.code, a.id]));
  const missing = codes.filter((c) => !idOf.has(c));
  if (missing.length) throw new Error(`Ledger posting ${posting.reference} rejected: unknown account ${missing.join(", ")}`);

  // Link a reversal to what it reverses (a transaction can be reversed once).
  const original = posting.reverses
    ? await tx.ledgerTransaction.findUnique({
        where: { reference: posting.reverses },
        select: { id: true, reversedBy: { select: { id: true } } },
      })
    : null;

  await tx.ledgerTransaction.create({
    data: {
      reference: posting.reference,
      kind: posting.kind,
      description: posting.description.slice(0, 300),
      source: posting.source ?? "system",
      reversesId: original && !original.reversedBy ? original.id : undefined,
      entries: {
        create: lines.map((l) => ({ accountId: idOf.get(l.account)!, direction: l.direction, amount: l.amount })),
      },
    },
  });
  return true;
}

export type LedgerIntegrity = {
  ok: boolean;
  /** Human-readable findings; empty when everything agrees. */
  problems: string[];
  /** Things a person should know that do not mean the books are wrong. */
  notes: string[];
  transactions: number;
  /** Total Naira owed to customers, from the ledger. */
  customerLiabilityNgn: number;
};

const count = (rows: { n: bigint | number }[]) => Number(rows[0]?.n ?? 0);

/**
 * Reconciles the ledger against itself and against the wallet records that mirror it.
 * Read-only. Run on a schedule; any finding needs a person to investigate.
 */
export async function checkLedgerIntegrity(db: Client = prisma): Promise<LedgerIntegrity> {
  const problems: string[] = [];
  const notes: string[] = [];
  const note = (n: number, text: string) => {
    if (n > 0) problems.push(`${n} ${text}`);
  };

  note(
    count(await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM (
        SELECT "transactionId" FROM "LedgerEntry" GROUP BY "transactionId"
        HAVING sum(CASE WHEN "direction" = 'DEBIT' THEN "amount" ELSE -"amount" END) <> 0 OR count(*) < 2
      ) t`),
    "transaction(s) do not balance",
  );
  note(
    count(await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "LedgerTransaction" t
      WHERE NOT EXISTS (SELECT 1 FROM "LedgerEntry" e WHERE e."transactionId" = t."id")`),
    "transaction(s) have no entries",
  );
  note(
    count(await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "LedgerAccount" a
      WHERE a."balance" <> coalesce((
        SELECT sum(CASE WHEN (a."type" IN ('ASSET', 'EXPENSE')) = (e."direction" = 'DEBIT') THEN e."amount" ELSE -e."amount" END)
        FROM "LedgerEntry" e WHERE e."accountId" = a."id"), 0)`),
    "account balance(s) differ from the sum of their entries",
  );
  note(
    count(await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "User" u
      LEFT JOIN "LedgerAccount" a ON a."userId" = u."id" AND a."currency" = 'NGN'
      WHERE u."walletBalanceNgn" <> coalesce(a."balance", 0)`),
    "customer wallet balance(s) differ from the ledger",
  );
  note(
    count(await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "LedgerAccount" a
      WHERE a."userId" IS NOT NULL AND a."balance" <> coalesce((
        SELECT sum(CASE WHEN w."direction" = 'CREDIT' THEN w."amountNgn" ELSE -w."amountNgn" END)
        FROM "WalletEntry" w WHERE w."userId" = a."userId"), 0)`),
    "customer ledger balance(s) differ from the wallet statement",
  );
  note(
    count(await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "WalletEntry" w
      WHERE NOT EXISTS (SELECT 1 FROM "LedgerTransaction" t WHERE t."reference" = w."reference")`),
    "wallet statement line(s) have no ledger transaction",
  );
  // Business records against the ledger: anything settled must have its posting.
  note(
    count(await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Payment" p
      WHERE p."status" = 'SUCCESS'
        AND NOT EXISTS (SELECT 1 FROM "LedgerTransaction" t WHERE t."reference" = 'fund:' || p."reference")`),
    "confirmed payment(s) have no ledger deposit",
  );
  note(
    count(await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Withdrawal" d
      WHERE d."status" = 'PAID'
        AND EXISTS (SELECT 1 FROM "LedgerTransaction" t WHERE t."reference" = 'wd:' || d."reference")
        AND NOT EXISTS (SELECT 1 FROM "LedgerTransaction" t WHERE t."reference" = 'wd-paid:' || d."reference")`),
    "paid withdrawal(s) have no ledger payout",
  );
  // Withdrawals that were never requested through the ledger (seeded or imported rows).
  // They cannot be reconciled, so they are listed for a person to review rather than failed.
  const legacy = count(await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM "Withdrawal" d
    WHERE d."status" IN ('PAID', 'PROCESSING', 'PENDING')
      AND NOT EXISTS (SELECT 1 FROM "LedgerTransaction" t WHERE t."reference" = 'wd:' || d."reference")`);
  if (legacy > 0) notes.push(`${legacy} open or paid withdrawal(s) were created outside the ledger (seed or imported data) and are not reconciled`);
  note(
    count(await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM (
        SELECT o."reference" FROM "CryptoOrder" o
        WHERE o."status" = 'COMPLETED' AND o."amountNgn" > 0
          AND ((o."side" = 'SELL' AND o."payoutMethod" = 'BANK')
            OR (o."side" = 'BUY' AND (o."paymentRef" IS NULL OR lower(btrim(o."paymentRef")) NOT LIKE 'wallet:%')))
        UNION ALL
        SELECT g."reference" FROM "GiftCardOrder" g
        WHERE g."status" = 'COMPLETED' AND g."amountNgn" > 0 AND g."payoutMethod" = 'BANK'
      ) s
      WHERE NOT EXISTS (SELECT 1 FROM "LedgerTransaction" t WHERE t."reference" = 'order-settled:' || s."reference")`),
    "completed order(s) settled outside the wallet have no ledger posting",
  );

  // The books as a whole: assets + expenses must equal liabilities + equity + revenue.
  const trial = await db.$queryRaw<{ diff: unknown }[]>`
    SELECT coalesce(sum(CASE WHEN "type" IN ('ASSET', 'EXPENSE') THEN "balance" ELSE -"balance" END), 0) AS diff FROM "LedgerAccount"`;
  if (Number(String(trial[0]?.diff ?? 0)) !== 0) problems.push(`trial balance is off by ${String(trial[0]?.diff)}`);

  const [transactions, liability] = await Promise.all([
    db.ledgerTransaction.count(),
    db.$queryRaw<{ total: unknown }[]>`SELECT coalesce(sum("balance"), 0) AS total FROM "LedgerAccount" WHERE "userId" IS NOT NULL`,
  ]);
  return {
    ok: problems.length === 0,
    problems,
    notes,
    transactions,
    customerLiabilityNgn: Number(String(liability[0]?.total ?? 0)),
  };
}
