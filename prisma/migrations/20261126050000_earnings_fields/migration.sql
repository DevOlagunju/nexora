-- What each trade earned (specification section 13: reports).
--
-- Records the market mid on each crypto order and quote, so the spread earned on a trade can be
-- reported, and lets the desk record what a gift card was redeemed or resold for. Additive only;
-- existing orders get no market mid and are reported as unpriced.
--
-- Rollback:
--   ALTER TABLE "CryptoOrder" DROP COLUMN "marketRateNgn";
--   ALTER TABLE "Quote" DROP COLUMN "marketRateNgn";
--   ALTER TABLE "GiftCardOrder" DROP COLUMN "redeemedNgn";

-- AlterTable
ALTER TABLE "CryptoOrder" ADD COLUMN     "marketRateNgn" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "GiftCardOrder" ADD COLUMN     "redeemedNgn" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "marketRateNgn" DECIMAL(18,4);

ALTER TABLE "CryptoOrder" ADD CONSTRAINT "CryptoOrder_marketRate_positive" CHECK ("marketRateNgn" IS NULL OR "marketRateNgn" > 0);
ALTER TABLE "GiftCardOrder" ADD CONSTRAINT "GiftCardOrder_redeemed_not_negative" CHECK ("redeemedNgn" IS NULL OR "redeemedNgn" >= 0);
