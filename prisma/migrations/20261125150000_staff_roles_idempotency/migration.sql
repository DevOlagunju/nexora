-- Adds staff roles (least-privilege desk permissions) and idempotency keys for the v1 API.
-- Additive only: no existing column or row is changed except giving current admins SUPER_ADMIN,
-- which keeps what they can do today.
--
-- Rollback:
--   DROP TABLE "IdempotencyKey";
--   ALTER TABLE "User" DROP COLUMN "staffRole";
--   DROP TYPE "StaffRole";
-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'TRADING_OFFICER', 'FINANCE_OFFICER', 'COMPLIANCE_OFFICER', 'CUSTOMER_SUPPORT', 'AUDITOR');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "staffRole" "StaffRole";

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_key" ON "IdempotencyKey"("userId", "key");

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing desk admins keep full access. New staff must be given a role explicitly.
UPDATE "User" SET "staffRole" = 'SUPER_ADMIN' WHERE "role" = 'ADMIN' AND "staffRole" IS NULL;