-- Ledger coverage for orders that never pass through a customer wallet:
--   a sale paid straight to a bank account    trading settlement -> provider clearing / bank
--   a purchase paid by manual bank transfer   bank -> trading settlement
-- New completions are posted by the application (src/lib/services/desk.ts). This migration
-- only backfills orders that were already Completed. No schema change.
--
-- Rollback: none needed. The rows added here are ordinary immutable ledger transactions with
-- references starting 'order-settled:' and source 'backfill'; they can stay if the code is
-- rolled back. To remove their effect, post reversing transactions.

DO $$
BEGIN
  CREATE TEMP TABLE _nexora_settle ON COMMIT DROP AS
    SELECT o."reference" AS ref, o."side"::text AS side, o."amountNgn" AS amt, o."payoutRef" AS payout_ref,
           coalesce(o."completedAt", o."updatedAt") AS at, 'Crypto' AS label
    FROM "CryptoOrder" o
    WHERE o."status" = 'COMPLETED' AND o."amountNgn" > 0
      AND ((o."side" = 'SELL' AND o."payoutMethod" = 'BANK')
        OR (o."side" = 'BUY' AND (o."paymentRef" IS NULL OR lower(btrim(o."paymentRef")) NOT LIKE 'wallet:%')))
    UNION ALL
    SELECT g."reference", 'SELL', g."amountNgn", g."payoutRef", coalesce(g."completedAt", g."updatedAt"), 'Gift card'
    FROM "GiftCardOrder" g
    WHERE g."status" = 'COMPLETED' AND g."amountNgn" > 0 AND g."payoutMethod" = 'BANK';

  DELETE FROM _nexora_settle s
  WHERE EXISTS (SELECT 1 FROM "LedgerTransaction" t WHERE t."reference" = 'order-settled:' || s.ref);

  INSERT INTO "LedgerTransaction" ("id", "reference", "kind", "description", "source", "postedAt")
  SELECT 'lt_' || md5('order-settled:' || s.ref), 'order-settled:' || s.ref,
         CASE WHEN s.side = 'SELL' THEN 'sale_payout' ELSE 'purchase_receipt' END,
         CASE WHEN s.side = 'SELL' THEN s.label || ' sale ' || s.ref || ' paid out'
              ELSE 'Payment received for crypto purchase ' || s.ref END,
         'backfill', s.at
  FROM _nexora_settle s;

  -- Debit side: trading settlement for a sale, the bank for a purchase.
  INSERT INTO "LedgerEntry" ("id", "transactionId", "accountId", "direction", "amount", "createdAt")
  SELECT 'le_' || md5('order-settled:' || s.ref || ':debit'), 'lt_' || md5('order-settled:' || s.ref),
         'la_' || md5(CASE WHEN s.side = 'SELL' THEN 'liability:trading_settlement:NGN' ELSE 'asset:bank:NGN' END),
         'DEBIT', s.amt, s.at
  FROM _nexora_settle s;

  -- Credit side: where a sale was paid from, or trading settlement for a purchase.
  INSERT INTO "LedgerEntry" ("id", "transactionId", "accountId", "direction", "amount", "createdAt")
  SELECT 'le_' || md5('order-settled:' || s.ref || ':credit'), 'lt_' || md5('order-settled:' || s.ref),
         'la_' || md5(CASE
           WHEN s.side = 'BUY' THEN 'liability:trading_settlement:NGN'
           WHEN s.payout_ref LIKE 'TRF\_%' THEN 'asset:provider_clearing:NGN'
           ELSE 'asset:bank:NGN'
         END),
         'CREDIT', s.amt, s.at
  FROM _nexora_settle s;
END $$;
