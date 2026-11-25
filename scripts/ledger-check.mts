/**
 * Reconciles the ledger: every transaction balances, every account balance equals the sum
 * of its entries, every customer's wallet balance equals their ledger account and their
 * statement, and the books as a whole balance. Read-only.
 *
 *   npm run ledger:check
 *
 * Exits 1 when anything disagrees, so it can gate a deploy or run from a scheduler.
 */
import "dotenv/config";

const { checkLedgerIntegrity } = await import("../src/lib/services/ledger");
const { prisma } = await import("../src/lib/db");

const report = await checkLedgerIntegrity();
const accounts = await prisma.ledgerAccount.findMany({
  where: { userId: null },
  orderBy: { code: "asc" },
  select: { code: true, type: true, balance: true },
});

console.log(`Ledger transactions:        ${report.transactions}`);
console.log(`Owed to customers (NGN):    ${report.customerLiabilityNgn.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`);
console.log("\nSystem accounts");
for (const a of accounts) {
  console.log(`  ${a.code.padEnd(36)} ${a.type.padEnd(10)} ${a.balance.toLocaleString("en-NG", { minimumFractionDigits: 2 }).padStart(18)}`);
}
if (report.notes.length) {
  console.log("\nNotes");
  for (const n of report.notes) console.log(`  - ${n}`);
}
if (report.ok) {
  console.log("\nOK: the ledger reconciles.");
  process.exit(0);
}
console.error("\nPROBLEMS");
for (const p of report.problems) console.error(`  - ${p}`);
process.exit(1);
