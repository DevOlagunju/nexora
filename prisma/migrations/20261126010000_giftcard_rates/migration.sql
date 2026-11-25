-- Gift card rates by brand, country and card type (specification section 8).
--
-- Adds GiftCardRate (a price per US dollar of face value for one brand, country and card type),
-- a card type on gift card orders, and the gift card variant on quotes. Converts existing order
-- country names to ISO codes. Prices are unchanged by this migration: every variant starts at the
-- brand's current rate.
--
-- Rollback:
--   DROP TABLE "GiftCardRate";
--   ALTER TABLE "GiftCardOrder" DROP COLUMN "cardType", ALTER COLUMN "country" SET DEFAULT 'USA';
--   ALTER TABLE "Quote" DROP COLUMN "country", DROP COLUMN "cardType";
--   DROP TYPE "GiftCardType";
--   Order countries stay as ISO codes (US, GB, DE, CA); map them back by hand if needed.

-- CreateEnum
CREATE TYPE "GiftCardType" AS ENUM ('ECODE', 'PHYSICAL');

-- AlterTable
ALTER TABLE "GiftCardOrder" ADD COLUMN     "cardType" "GiftCardType",
ALTER COLUMN "country" SET DEFAULT 'US';

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "cardType" "GiftCardType",
ADD COLUMN     "country" TEXT;

-- CreateTable
CREATE TABLE "GiftCardRate" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "cardType" "GiftCardType" NOT NULL,
    "rateNgn" DECIMAL(18,4) NOT NULL,
    "minFaceUsd" DECIMAL(12,2) NOT NULL,
    "maxFaceUsd" DECIMAL(12,2),
    "denominations" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCardRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GiftCardRate_brand_idx" ON "GiftCardRate"("brand");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardRate_brand_country_cardType_key" ON "GiftCardRate"("brand", "country", "cardType");

-- ---------------------------------------------------------------------------------------
-- Rules the database enforces.
-- ---------------------------------------------------------------------------------------

ALTER TABLE "GiftCardRate" ADD CONSTRAINT "GiftCardRate_values_valid"
  CHECK ("rateNgn" > 0 AND "minFaceUsd" > 0 AND ("maxFaceUsd" IS NULL OR "maxFaceUsd" >= "minFaceUsd"));
ALTER TABLE "GiftCardRate" ADD CONSTRAINT "GiftCardRate_country_code" CHECK ("country" ~ '^[A-Z]{2}$');
-- At most one default variant per brand.
CREATE UNIQUE INDEX "GiftCardRate_one_default_per_brand" ON "GiftCardRate"("brand") WHERE "isDefault";

-- ---------------------------------------------------------------------------------------
-- Existing orders: country names become ISO codes (USA -> US, UK -> GB, GERMANY -> DE,
-- CANADA -> CA). Values that are not recognised are left as they are.
-- ---------------------------------------------------------------------------------------

UPDATE "GiftCardOrder" SET "country" = CASE upper(btrim("country"))
    WHEN 'USA' THEN 'US' WHEN 'US' THEN 'US' WHEN 'UNITED STATES' THEN 'US'
    WHEN 'UK' THEN 'GB' WHEN 'GB' THEN 'GB' WHEN 'GBR' THEN 'GB' WHEN 'UNITED KINGDOM' THEN 'GB'
    WHEN 'GERMANY' THEN 'DE' WHEN 'DE' THEN 'DE' WHEN 'DEU' THEN 'DE'
    WHEN 'CANADA' THEN 'CA' WHEN 'CA' THEN 'CA' WHEN 'CAN' THEN 'CA'
    ELSE "country" END;

-- ---------------------------------------------------------------------------------------
-- Variants. Today every country and card type is paid the brand's single rate, so each brand
-- gets a variant for each country the mobile app offers (US, GB, DE, CA) and each card type,
-- all at that rate: prices do not change when this migration runs. The desk then sets each
-- variant's own price. US e-code is each brand's default.
-- ---------------------------------------------------------------------------------------

INSERT INTO "GiftCardRate" ("id", "brand", "country", "cardType", "rateNgn", "minFaceUsd", "maxFaceUsd", "isActive", "isDefault", "createdAt", "updatedAt")
SELECT 'gcr_' || md5(r."symbol" || ':' || c.country || ':' || t.card_type),
       r."symbol", c.country, t.card_type::"GiftCardType",
       r."sellRateNgn", round(r."minAmount", 2), round(r."maxAmount", 2),
       r."isActive",
       (c.country = 'US' AND t.card_type = 'ECODE'),
       now(), now()
FROM "Rate" r
CROSS JOIN (VALUES ('US'), ('GB'), ('DE'), ('CA')) AS c(country)
CROSS JOIN (VALUES ('ECODE'), ('PHYSICAL')) AS t(card_type)
WHERE r."kind" = 'GIFTCARD' AND r."sellRateNgn" > 0 AND r."minAmount" > 0;

DO $$
DECLARE
  brands integer;
  defaults integer;
BEGIN
  SELECT count(*) INTO brands FROM "Rate" WHERE "kind" = 'GIFTCARD' AND "sellRateNgn" > 0 AND "minAmount" > 0;
  SELECT count(*) INTO defaults FROM "GiftCardRate" WHERE "isDefault";
  IF defaults <> brands THEN
    RAISE EXCEPTION 'Gift card rates: % brand(s) but % default variant(s). Nothing was changed.', brands, defaults;
  END IF;
END $$;
