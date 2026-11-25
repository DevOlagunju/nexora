-- Blockchain deposits (specification sections 7 and 11).
--
-- Per-customer deposit addresses issued by a deposit provider, the deposits the provider reports
-- (with confirmations), and every provider webhook stored before it is processed. Additive only.
--
-- Rollback:
--   DROP TABLE "WebhookEvent", "BlockchainDeposit", "DepositAddress";
--   DROP TYPE "DepositStatus";

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'CREDITED', 'UNDERPAID', 'OVERPAID', 'UNMATCHED', 'WRONG_ASSET', 'REVERSED', 'RESOLVED');

-- CreateTable
CREATE TABLE "DepositAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "memo" TEXT,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockchainDeposit" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" TEXT NOT NULL DEFAULT '0',
    "toAddress" TEXT NOT NULL,
    "fromAddress" TEXT,
    "amount" DECIMAL(36,18) NOT NULL,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "userId" TEXT,
    "orderId" TEXT,
    "note" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockchainDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "signatureOk" BOOLEAN NOT NULL,
    "payload" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepositAddress_userId_symbol_networkId_key" ON "DepositAddress"("userId", "symbol", "networkId");

-- CreateIndex
CREATE UNIQUE INDEX "DepositAddress_networkId_address_key" ON "DepositAddress"("networkId", "address");

-- CreateIndex
CREATE INDEX "BlockchainDeposit_status_firstSeenAt_idx" ON "BlockchainDeposit"("status", "firstSeenAt");

-- CreateIndex
CREATE INDEX "BlockchainDeposit_orderId_idx" ON "BlockchainDeposit"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainDeposit_network_txHash_txIndex_key" ON "BlockchainDeposit"("network", "txHash", "txIndex");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_receivedAt_idx" ON "WebhookEvent"("provider", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- AddForeignKey
ALTER TABLE "DepositAddress" ADD CONSTRAINT "DepositAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositAddress" ADD CONSTRAINT "DepositAddress_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "BlockchainNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockchainDeposit" ADD CONSTRAINT "BlockchainDeposit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CryptoOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BlockchainDeposit" ADD CONSTRAINT "BlockchainDeposit_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "BlockchainDeposit" ADD CONSTRAINT "BlockchainDeposit_confirmations_valid" CHECK ("confirmations" >= 0);
