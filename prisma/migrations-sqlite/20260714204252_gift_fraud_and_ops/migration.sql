-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
INSERT INTO "new_GiftCardOrder" ("accountName", "accountNumber", "adminNote", "amountNgn", "bankName", "brand", "cardCodeEncrypted", "cardCodeIv", "completedAt", "country", "createdAt", "faceValueUsd", "id", "imageNote", "payoutRef", "rateNgn", "reference", "status", "updatedAt", "userId") SELECT "accountName", "accountNumber", "adminNote", "amountNgn", "bankName", "brand", "cardCodeEncrypted", "cardCodeIv", "completedAt", "country", "createdAt", "faceValueUsd", "id", "imageNote", "payoutRef", "rateNgn", "reference", "status", "updatedAt", "userId" FROM "GiftCardOrder";
DROP TABLE "GiftCardOrder";
ALTER TABLE "new_GiftCardOrder" RENAME TO "GiftCardOrder";
CREATE UNIQUE INDEX "GiftCardOrder_reference_key" ON "GiftCardOrder"("reference");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
