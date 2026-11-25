-- Double-entry ledger (specification section 9).
--
-- Adds LedgerAccount / LedgerTransaction / LedgerEntry and makes the database enforce:
--   * every transaction balances (debits = credits), checked at commit;
--   * posted transactions and entries can never be edited or deleted;
--   * an account balance changes only through entries;
--   * a customer balance can never go negative;
--   * User.walletBalanceNgn is a copy of the customer's ledger account, not set by the app.
-- Existing wallet history is backfilled; the migration aborts if any balance would change.
--
-- Rollback (loses nothing: WalletEntry and User.walletBalanceNgn are untouched by a rollback):
--   DROP TRIGGER "User_wallet_balance_guard" ON "User";
--   DROP TABLE "LedgerEntry", "LedgerTransaction", "LedgerAccount" CASCADE;
--   DROP FUNCTION nexora_ledger_apply_entry, nexora_ledger_guard_account, nexora_ledger_mirror_wallet,
--     nexora_wallet_balance_guard, nexora_ledger_immutable, nexora_ledger_entry_same_tx, nexora_ledger_check_balanced;
--   DROP TYPE "LedgerAccountType";
--   and redeploy the application version from before this migration.
-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "userId" TEXT,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'system',
    "reversesId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");

-- CreateIndex
CREATE INDEX "LedgerAccount_userId_idx" ON "LedgerAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_reference_key" ON "LedgerTransaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_reversesId_key" ON "LedgerTransaction"("reversesId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_kind_postedAt_idx" ON "LedgerTransaction"("kind", "postedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry"("transactionId");

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------
-- Rules the database enforces itself, whatever the application does.
-- ---------------------------------------------------------------------------------------

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_amount_positive" CHECK ("amount" > 0);
-- A customer can never be owed a negative amount.
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_customer_not_negative" CHECK ("userId" IS NULL OR "balance" >= 0);
CREATE UNIQUE INDEX "LedgerAccount_one_per_customer_currency" ON "LedgerAccount"("userId", "currency") WHERE "userId" IS NOT NULL;

-- An account's balance is the running total of its entries, kept by the database.
-- Assets and expenses grow with debits; liabilities, equity and revenue grow with credits.
CREATE FUNCTION nexora_ledger_apply_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  acct_type "LedgerAccountType";
  delta numeric;
BEGIN
  SELECT "type" INTO acct_type FROM "LedgerAccount" WHERE "id" = NEW."accountId" FOR UPDATE;
  IF (acct_type IN ('ASSET', 'EXPENSE')) = (NEW."direction" = 'DEBIT') THEN
    delta := NEW."amount";
  ELSE
    delta := -NEW."amount";
  END IF;
  UPDATE "LedgerAccount" SET "balance" = "balance" + delta WHERE "id" = NEW."accountId";
  RETURN NEW;
END $$;
CREATE TRIGGER "LedgerEntry_apply" AFTER INSERT ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION nexora_ledger_apply_entry();

-- Nothing but the trigger above may change a balance, and an account keeps its identity.
CREATE FUNCTION nexora_ledger_guard_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."balance" := 0;
    RETURN NEW;
  END IF;
  IF NEW."balance" IS DISTINCT FROM OLD."balance" AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'LedgerAccount.balance changes only through ledger entries';
  END IF;
  IF NEW."code" IS DISTINCT FROM OLD."code" OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    RAISE EXCEPTION 'A ledger account cannot change its code, type, currency or owner';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LedgerAccount_guard" BEFORE INSERT OR UPDATE ON "LedgerAccount"
  FOR EACH ROW EXECUTE FUNCTION nexora_ledger_guard_account();

-- User.walletBalanceNgn is a copy of the customer's Naira ledger account, kept in step here.
CREATE FUNCTION nexora_ledger_mirror_wallet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "User" SET "walletBalanceNgn" = NEW."balance" WHERE "id" = NEW."userId";
  RETURN NULL;
END $$;
CREATE TRIGGER "LedgerAccount_mirror_wallet" AFTER UPDATE OF "balance" ON "LedgerAccount"
  FOR EACH ROW WHEN (NEW."userId" IS NOT NULL AND NEW."currency" = 'NGN')
  EXECUTE FUNCTION nexora_ledger_mirror_wallet();

-- ---------------------------------------------------------------------------------------
-- Chart of accounts (system accounts). Customer accounts are "customer:<userId>:NGN".
-- The mapping must be confirmed by finance against the real custody and settlement set-up.
-- ---------------------------------------------------------------------------------------

INSERT INTO "LedgerAccount" ("id", "code", "name", "type", "currency") VALUES
  ('la_' || md5('asset:provider_clearing:NGN'), 'asset:provider_clearing:NGN', 'Payment provider clearing (money held at the gateway)', 'ASSET', 'NGN'),
  ('la_' || md5('asset:bank:NGN'), 'asset:bank:NGN', 'Operating bank account', 'ASSET', 'NGN'),
  ('la_' || md5('liability:payout_clearing:NGN'), 'liability:payout_clearing:NGN', 'Payouts in flight (withdrawals requested, not yet paid)', 'LIABILITY', 'NGN'),
  ('la_' || md5('liability:trading_settlement:NGN'), 'liability:trading_settlement:NGN', 'Trading settlement (Naira side of crypto and gift card trades)', 'LIABILITY', 'NGN'),
  ('la_' || md5('revenue:fees:NGN'), 'revenue:fees:NGN', 'Fee revenue', 'REVENUE', 'NGN'),
  ('la_' || md5('expense:referral_bonus:NGN'), 'expense:referral_bonus:NGN', 'Referral bonuses paid', 'EXPENSE', 'NGN'),
  ('la_' || md5('equity:adjustments:NGN'), 'equity:adjustments:NGN', 'Opening balances and approved adjustments', 'EQUITY', 'NGN');

-- ---------------------------------------------------------------------------------------
-- Backfill: every existing wallet movement becomes a balanced ledger transaction, so
-- balances are derived from the ledger from now on. Aborts if any balance would change.
-- ---------------------------------------------------------------------------------------

CREATE TEMP TABLE _nexora_old_balances AS SELECT "id", "walletBalanceNgn" AS balance FROM "User";

INSERT INTO "LedgerAccount" ("id", "code", "name", "type", "currency", "userId")
SELECT 'la_' || md5('customer:' || u."id" || ':NGN'), 'customer:' || u."id" || ':NGN', 'Customer wallet', 'LIABILITY', 'NGN', u."id"
FROM "User" u;

INSERT INTO "LedgerTransaction" ("id", "reference", "kind", "description", "source", "reversesId", "postedAt")
SELECT
  'lt_' || md5(w."reference"),
  w."reference",
  CASE
    WHEN w."reference" LIKE 'fund:%' THEN 'deposit'
    WHEN w."reference" LIKE 'buy-refund:%' THEN 'purchase_refund'
    WHEN w."reference" LIKE 'buy:%' THEN 'purchase'
    WHEN w."reference" LIKE 'order:%' THEN 'sale_proceeds'
    WHEN w."reference" LIKE 'wd-refund:%' THEN 'withdrawal_refund'
    WHEN w."reference" LIKE 'wd:%' THEN 'withdrawal'
    WHEN w."reference" LIKE 'referral:%' THEN 'referral_bonus'
    ELSE 'adjustment'
  END,
  w."description",
  'backfill',
  CASE
    WHEN w."reference" LIKE 'wd-refund:%' THEN
      (SELECT 'lt_' || md5(o."reference") FROM "WalletEntry" o WHERE o."reference" = 'wd:' || substr(w."reference", 11))
    WHEN w."reference" LIKE 'buy-refund:%' THEN
      (SELECT 'lt_' || md5(o."reference") FROM "WalletEntry" o WHERE o."reference" = 'buy:' || substr(w."reference", 12))
  END,
  w."createdAt"
FROM "WalletEntry" w;

-- The customer's side.
INSERT INTO "LedgerEntry" ("id", "transactionId", "accountId", "direction", "amount", "createdAt")
SELECT 'le_' || md5(w."reference" || ':customer'), 'lt_' || md5(w."reference"),
       'la_' || md5('customer:' || w."userId" || ':NGN'), w."direction", w."amountNgn", w."createdAt"
FROM "WalletEntry" w;

-- The other side.
INSERT INTO "LedgerEntry" ("id", "transactionId", "accountId", "direction", "amount", "createdAt")
SELECT 'le_' || md5(w."reference" || ':counter'), 'lt_' || md5(w."reference"),
       'la_' || md5(CASE
         WHEN w."reference" LIKE 'fund:%' THEN 'asset:provider_clearing:NGN'
         WHEN w."reference" LIKE 'buy-refund:%' OR w."reference" LIKE 'buy:%' OR w."reference" LIKE 'order:%' THEN 'liability:trading_settlement:NGN'
         WHEN w."reference" LIKE 'wd-refund:%' OR w."reference" LIKE 'wd:%' THEN 'liability:payout_clearing:NGN'
         WHEN w."reference" LIKE 'referral:%' THEN 'expense:referral_bonus:NGN'
         ELSE 'equity:adjustments:NGN'
       END),
       (CASE WHEN w."direction" = 'CREDIT' THEN 'DEBIT' ELSE 'CREDIT' END)::"LedgerDirection",
       w."amountNgn", w."createdAt"
FROM "WalletEntry" w;

-- Withdrawals already paid: the money left payout clearing, and the fee became revenue.
INSERT INTO "LedgerTransaction" ("id", "reference", "kind", "description", "source", "postedAt")
SELECT 'lt_' || md5('wd-paid:' || d."reference"), 'wd-paid:' || d."reference", 'withdrawal_paid',
       'Withdrawal ' || d."reference" || ' paid', 'backfill', COALESCE(d."processedAt", d."updatedAt")
FROM "Withdrawal" d
WHERE d."status" = 'PAID' AND EXISTS (SELECT 1 FROM "WalletEntry" w WHERE w."reference" = 'wd:' || d."reference");

INSERT INTO "LedgerEntry" ("id", "transactionId", "accountId", "direction", "amount", "createdAt")
SELECT 'le_' || md5('wd-paid:' || d."reference" || ':clearing'), 'lt_' || md5('wd-paid:' || d."reference"),
       'la_' || md5('liability:payout_clearing:NGN'), 'DEBIT', d."amountNgn" + d."feeNgn", COALESCE(d."processedAt", d."updatedAt")
FROM "Withdrawal" d
WHERE d."status" = 'PAID' AND EXISTS (SELECT 1 FROM "WalletEntry" w WHERE w."reference" = 'wd:' || d."reference");

INSERT INTO "LedgerEntry" ("id", "transactionId", "accountId", "direction", "amount", "createdAt")
SELECT 'le_' || md5('wd-paid:' || d."reference" || ':out'), 'lt_' || md5('wd-paid:' || d."reference"),
       'la_' || md5(CASE WHEN d."payoutRef" LIKE 'TRF\_%' THEN 'asset:provider_clearing:NGN' ELSE 'asset:bank:NGN' END),
       'CREDIT', d."amountNgn", COALESCE(d."processedAt", d."updatedAt")
FROM "Withdrawal" d
WHERE d."status" = 'PAID' AND EXISTS (SELECT 1 FROM "WalletEntry" w WHERE w."reference" = 'wd:' || d."reference");

INSERT INTO "LedgerEntry" ("id", "transactionId", "accountId", "direction", "amount", "createdAt")
SELECT 'le_' || md5('wd-paid:' || d."reference" || ':fee'), 'lt_' || md5('wd-paid:' || d."reference"),
       'la_' || md5('revenue:fees:NGN'), 'CREDIT', d."feeNgn", COALESCE(d."processedAt", d."updatedAt")
FROM "Withdrawal" d
WHERE d."status" = 'PAID' AND d."feeNgn" > 0 AND EXISTS (SELECT 1 FROM "WalletEntry" w WHERE w."reference" = 'wd:' || d."reference");

DO $$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "User" u JOIN _nexora_old_balances o ON o."id" = u."id" WHERE u."walletBalanceNgn" <> o.balance;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Ledger backfill would change % wallet balance(s). Nothing was changed; investigate before retrying.', bad;
  END IF;
  SELECT count(*) INTO bad FROM (
    SELECT "transactionId" FROM "LedgerEntry" GROUP BY "transactionId"
    HAVING sum(CASE WHEN "direction" = 'DEBIT' THEN "amount" ELSE -"amount" END) <> 0 OR count(*) < 2
  ) t;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Ledger backfill produced % unbalanced transaction(s).', bad;
  END IF;
END $$;

DROP TABLE _nexora_old_balances;

-- ---------------------------------------------------------------------------------------
-- From here on the ledger is closed to edits.
-- ---------------------------------------------------------------------------------------

-- The wallet balance on User can only follow the ledger.
CREATE FUNCTION nexora_wallet_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."walletBalanceNgn" <> 0 THEN
      RAISE EXCEPTION 'A new user starts with a zero wallet balance; credit the wallet through the ledger';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."walletBalanceNgn" IS DISTINCT FROM OLD."walletBalanceNgn" AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'User.walletBalanceNgn is derived from the ledger and cannot be set directly';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "User_wallet_balance_guard" BEFORE INSERT OR UPDATE OF "walletBalanceNgn" ON "User"
  FOR EACH ROW EXECUTE FUNCTION nexora_wallet_balance_guard();

-- Posted transactions and entries can never be edited or deleted.
CREATE FUNCTION nexora_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ledger rows are immutable (% on %): post a reversing transaction instead', TG_OP, TG_TABLE_NAME;
END $$;
CREATE TRIGGER "LedgerEntry_immutable" BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION nexora_ledger_immutable();
CREATE TRIGGER "LedgerEntry_no_truncate" BEFORE TRUNCATE ON "LedgerEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION nexora_ledger_immutable();
CREATE TRIGGER "LedgerTransaction_immutable" BEFORE UPDATE OR DELETE ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION nexora_ledger_immutable();
CREATE TRIGGER "LedgerTransaction_no_truncate" BEFORE TRUNCATE ON "LedgerTransaction"
  FOR EACH STATEMENT EXECUTE FUNCTION nexora_ledger_immutable();

-- An entry can only be written together with its transaction (same database transaction),
-- so a posted transaction can never have entries added to it later.
CREATE FUNCTION nexora_ledger_entry_same_tx() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "LedgerTransaction" t
    WHERE t."id" = NEW."transactionId" AND t.xmin::text = (txid_current() % 4294967296)::text
  ) THEN
    RAISE EXCEPTION 'Ledger entries must be posted together with their transaction';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LedgerEntry_same_tx" BEFORE INSERT ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION nexora_ledger_entry_same_tx();

-- Checked when the database transaction commits: debits must equal credits.
CREATE FUNCTION nexora_ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tx_id text;
  debits numeric;
  credits numeric;
  n integer;
BEGIN
  IF TG_TABLE_NAME = 'LedgerTransaction' THEN tx_id := NEW."id"; ELSE tx_id := NEW."transactionId"; END IF;
  SELECT coalesce(sum("amount") FILTER (WHERE "direction" = 'DEBIT'), 0),
         coalesce(sum("amount") FILTER (WHERE "direction" = 'CREDIT'), 0),
         count(*)
    INTO debits, credits, n
    FROM "LedgerEntry" WHERE "transactionId" = tx_id;
  IF n < 2 OR debits <> credits THEN
    RAISE EXCEPTION 'Ledger transaction % does not balance (debits %, credits %, % entries)', tx_id, debits, credits, n;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "LedgerEntry_balanced" AFTER INSERT ON "LedgerEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nexora_ledger_check_balanced();
CREATE CONSTRAINT TRIGGER "LedgerTransaction_balanced" AFTER INSERT ON "LedgerTransaction"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nexora_ledger_check_balanced();
