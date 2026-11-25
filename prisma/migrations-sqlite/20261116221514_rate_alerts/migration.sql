-- CreateTable
CREATE TABLE "RateAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "targetNgn" REAL NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "triggeredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RateAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RateAlert_isActive_kind_symbol_idx" ON "RateAlert"("isActive", "kind", "symbol");

-- CreateIndex
CREATE INDEX "RateAlert_userId_createdAt_idx" ON "RateAlert"("userId", "createdAt");
