-- CreateTable
CREATE TABLE "WalletEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amountNgn" REAL NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountNgn" REAL NOT NULL,
    "feeNgn" REAL NOT NULL DEFAULT 0,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payoutRef" TEXT,
    "adminNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "processedAt" DATETIME,
    CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CryptoOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "amountCrypto" REAL NOT NULL,
    "rateNgn" REAL NOT NULL,
    "amountNgn" REAL NOT NULL,
    "depositAddress" TEXT,
    "userReceiveAddress" TEXT,
    "txHash" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "paymentRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_DEPOSIT',
    "adminNote" TEXT,
    "payoutRef" TEXT,
    "payoutMethod" TEXT NOT NULL DEFAULT 'BANK',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "CryptoOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CryptoOrder" ("accountName", "accountNumber", "adminNote", "amountCrypto", "amountNgn", "bankName", "completedAt", "createdAt", "depositAddress", "id", "network", "paymentRef", "payoutRef", "rateNgn", "reference", "side", "status", "symbol", "txHash", "updatedAt", "userId", "userReceiveAddress") SELECT "accountName", "accountNumber", "adminNote", "amountCrypto", "amountNgn", "bankName", "completedAt", "createdAt", "depositAddress", "id", "network", "paymentRef", "payoutRef", "rateNgn", "reference", "side", "status", "symbol", "txHash", "updatedAt", "userId", "userReceiveAddress" FROM "CryptoOrder";
DROP TABLE "CryptoOrder";
ALTER TABLE "new_CryptoOrder" RENAME TO "CryptoOrder";
CREATE UNIQUE INDEX "CryptoOrder_reference_key" ON "CryptoOrder"("reference");
CREATE TABLE "new_GiftCardOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'USA',
    "faceValueUsd" REAL NOT NULL,
    "rateNgn" REAL NOT NULL,
    "amountNgn" REAL NOT NULL,
    "cardCodeEncrypted" TEXT NOT NULL,
    "cardCodeIv" TEXT NOT NULL,
    "imageNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNDER_REVIEW',
    "adminNote" TEXT,
    "payoutRef" TEXT,
    "payoutMethod" TEXT NOT NULL DEFAULT 'BANK',
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "fraudFlag" BOOLEAN NOT NULL DEFAULT false,
    "fraudNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "GiftCardOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GiftCardOrder" ("accountName", "accountNumber", "adminNote", "amountNgn", "bankName", "brand", "cardCodeEncrypted", "cardCodeIv", "completedAt", "country", "createdAt", "faceValueUsd", "fraudFlag", "fraudNote", "id", "imageNote", "payoutRef", "rateNgn", "reference", "status", "updatedAt", "userId") SELECT "accountName", "accountNumber", "adminNote", "amountNgn", "bankName", "brand", "cardCodeEncrypted", "cardCodeIv", "completedAt", "country", "createdAt", "faceValueUsd", "fraudFlag", "fraudNote", "id", "imageNote", "payoutRef", "rateNgn", "reference", "status", "updatedAt", "userId" FROM "GiftCardOrder";
DROP TABLE "GiftCardOrder";
ALTER TABLE "new_GiftCardOrder" RENAME TO "GiftCardOrder";
CREATE UNIQUE INDEX "GiftCardOrder_reference_key" ON "GiftCardOrder"("reference");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "walletBalanceNgn" REAL NOT NULL DEFAULT 0,
    "transactionPinHash" TEXT,
    "pinFailedCount" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" DATETIME,
    "referralCode" TEXT,
    "referredById" TEXT,
    CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "email", "fullName", "id", "passwordHash", "phone", "role", "updatedAt") SELECT "createdAt", "email", "fullName", "id", "passwordHash", "phone", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "WalletEntry_reference_key" ON "WalletEntry"("reference");

-- CreateIndex
CREATE INDEX "WalletEntry_userId_createdAt_idx" ON "WalletEntry"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Withdrawal_reference_key" ON "Withdrawal"("reference");

-- CreateIndex
CREATE INDEX "Withdrawal_status_createdAt_idx" ON "Withdrawal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Withdrawal_userId_createdAt_idx" ON "Withdrawal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
