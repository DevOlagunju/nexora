-- Quotes: a locked price with an expiry that an order can be created from (specification section 10).
-- Additive only: one new table. Orders created without a quote behave exactly as before.
--
-- Rollback:
--   DROP TABLE "Quote";

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "side" "TradeSide" NOT NULL,
    "symbol" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "rateNgn" DECIMAL(18,4) NOT NULL,
    "feeNgn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountNgn" DECIMAL(18,2) NOT NULL,
    "rateSource" TEXT NOT NULL DEFAULT 'desk',
    "rateUpdatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "orderReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_reference_key" ON "Quote"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_orderReference_key" ON "Quote"("orderReference");

-- CreateIndex
CREATE INDEX "Quote_userId_createdAt_idx" ON "Quote"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_expiresAt_idx" ON "Quote"("expiresAt");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A quote must promise a positive amount, and cannot expire before it was made.
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_amounts_positive" CHECK ("amount" > 0 AND "rateNgn" > 0 AND "amountNgn" > 0 AND "feeNgn" >= 0);
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_expires_after_created" CHECK ("expiresAt" > "createdAt");
