-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN "bankCode" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_KycProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bvnLast4" TEXT,
    "ninLast4" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "bankCode" TEXT,
    "accountVerified" BOOLEAN NOT NULL DEFAULT false,
    "nameMatch" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "reviewNote" TEXT,
    "submittedAt" DATETIME,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KycProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_KycProfile" ("accountName", "accountNumber", "bankName", "bvnLast4", "createdAt", "id", "ninLast4", "reviewNote", "reviewedAt", "status", "submittedAt", "updatedAt", "userId") SELECT "accountName", "accountNumber", "bankName", "bvnLast4", "createdAt", "id", "ninLast4", "reviewNote", "reviewedAt", "status", "submittedAt", "updatedAt", "userId" FROM "KycProfile";
DROP TABLE "KycProfile";
ALTER TABLE "new_KycProfile" RENAME TO "KycProfile";
CREATE UNIQUE INDEX "KycProfile_userId_key" ON "KycProfile"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
