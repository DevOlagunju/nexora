-- Spreads on crypto desk rates (specification section 10).
--
-- The margin is built into the rate, with no separate trading fee: customers sell below the market
-- mid and buy above it, by a percentage set per asset on the admin desk. Replaces the hardcoded
-- margin in the rate sync (sell = market, buy = market + N20 per dollar). Records the market mid the
-- desk rates were last synced from. Existing rates are not changed by this migration.
--
-- Rollback:
--   ALTER TABLE "Rate" DROP COLUMN "sellSpreadPct", DROP COLUMN "buySpreadPct",
--     DROP COLUMN "marketRateNgn", DROP COLUMN "marketRateAt";

-- AlterTable
ALTER TABLE "Rate" ADD COLUMN     "buySpreadPct" DECIMAL(6,3) NOT NULL DEFAULT 1,
ADD COLUMN     "marketRateAt" TIMESTAMP(3),
ADD COLUMN     "marketRateNgn" DECIMAL(18,4),
ADD COLUMN     "sellSpreadPct" DECIMAL(6,3) NOT NULL DEFAULT 1;

ALTER TABLE "Rate" ADD CONSTRAINT "Rate_spreads_valid" CHECK ("sellSpreadPct" >= 0 AND "sellSpreadPct" < 50 AND "buySpreadPct" >= 0 AND "buySpreadPct" < 50);
