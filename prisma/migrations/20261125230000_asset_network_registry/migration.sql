-- Asset and network registry (specification sections 5 and 7).
--
-- Adds BlockchainNetwork and AssetNetwork, so admins decide which assets trade on which networks,
-- where deposits go and how many confirmations they need, instead of a fixed list in code.
-- Every existing PlatformWallet row is copied in as that asset's default network; the migration
-- aborts if any is missed. PlatformWallet itself is left in place, unused, to be dropped later.
--
-- Rollback:
--   DROP TABLE "AssetNetwork", "BlockchainNetwork";
--   and redeploy the application version from before this migration (it reads PlatformWallet,
--   which this migration does not change).

-- CreateTable
CREATE TABLE "BlockchainNetwork" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressPattern" TEXT NOT NULL,
    "addressHint" TEXT NOT NULL,
    "explorerTxUrl" TEXT,
    "defaultConfirmations" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockchainNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetNetwork" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "depositAddress" TEXT NOT NULL,
    "depositMemo" TEXT,
    "confirmations" INTEGER NOT NULL,
    "depositsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "withdrawalsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainNetwork_code_key" ON "BlockchainNetwork"("code");

-- CreateIndex
CREATE INDEX "AssetNetwork_symbol_idx" ON "AssetNetwork"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "AssetNetwork_symbol_networkId_key" ON "AssetNetwork"("symbol", "networkId");

-- AddForeignKey
ALTER TABLE "AssetNetwork" ADD CONSTRAINT "AssetNetwork_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "BlockchainNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------
-- Rules the database enforces.
-- ---------------------------------------------------------------------------------------

ALTER TABLE "BlockchainNetwork" ADD CONSTRAINT "BlockchainNetwork_confirmations_positive" CHECK ("defaultConfirmations" >= 1);
ALTER TABLE "AssetNetwork" ADD CONSTRAINT "AssetNetwork_confirmations_positive" CHECK ("confirmations" >= 1);
ALTER TABLE "AssetNetwork" ADD CONSTRAINT "AssetNetwork_address_present" CHECK (length(btrim("depositAddress")) >= 10);
-- At most one default network per asset.
CREATE UNIQUE INDEX "AssetNetwork_one_default_per_symbol" ON "AssetNetwork"("symbol") WHERE "isDefault";

-- ---------------------------------------------------------------------------------------
-- Networks. Address patterns are format checks (catch wrong-network pastes and typos),
-- not checksum validation. Confirmation counts are starting policy, to be confirmed by
-- operations; each asset can set its own.
-- ---------------------------------------------------------------------------------------

INSERT INTO "BlockchainNetwork" ("id", "code", "name", "addressPattern", "addressHint", "explorerTxUrl", "defaultConfirmations", "updatedAt") VALUES
  ('net_trc20', 'TRC20', 'Tron (TRC20)', '^T[1-9A-HJ-NP-Za-km-z]{33}$', 'a Tron address (starts with T, 34 characters)', 'https://tronscan.org/#/transaction/{tx}', 20, now()),
  ('net_erc20', 'ERC20', 'Ethereum (ERC20)', '^0x[0-9a-fA-F]{40}$', 'an Ethereum address (0x followed by 40 hex characters)', 'https://etherscan.io/tx/{tx}', 12, now()),
  ('net_bep20', 'BEP20', 'BNB Smart Chain (BEP20)', '^0x[0-9a-fA-F]{40}$', 'a BNB Smart Chain address (0x followed by 40 hex characters)', 'https://bscscan.com/tx/{tx}', 15, now()),
  ('net_btc', 'BTC', 'Bitcoin', '^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$', 'a Bitcoin address (bc1…, 1… or 3…)', 'https://mempool.space/tx/{tx}', 2, now());

-- Any network an existing deposit wallet uses that is not in the list above gets a row too,
-- with a permissive pattern, so no configured wallet is lost. Review these by hand.
INSERT INTO "BlockchainNetwork" ("id", "code", "name", "addressPattern", "addressHint", "defaultConfirmations", "isActive", "updatedAt")
SELECT DISTINCT 'net_' || md5(upper(btrim(w."network"))), upper(btrim(w."network")), upper(btrim(w."network")),
       '^[A-Za-z0-9:._-]{10,128}$', 'a wallet address for this network', 1, true, now()
FROM "PlatformWallet" w
WHERE NOT EXISTS (SELECT 1 FROM "BlockchainNetwork" n WHERE n."code" = upper(btrim(w."network")));

-- ---------------------------------------------------------------------------------------
-- Copy every existing deposit wallet into the registry as that asset's default network.
-- ---------------------------------------------------------------------------------------

INSERT INTO "AssetNetwork" ("id", "symbol", "networkId", "depositAddress", "confirmations", "depositsEnabled", "withdrawalsEnabled", "isDefault", "note", "createdAt", "updatedAt")
SELECT 'an_' || md5(w."symbol" || ':' || n."code"), w."symbol", n."id", btrim(w."address"), n."defaultConfirmations",
       w."isActive", w."isActive", true, w."note", w."createdAt", now()
FROM "PlatformWallet" w
JOIN "BlockchainNetwork" n ON n."code" = upper(btrim(w."network"));

DO $$
DECLARE
  wallets integer;
  copied integer;
BEGIN
  SELECT count(*) INTO wallets FROM "PlatformWallet";
  SELECT count(*) INTO copied FROM "AssetNetwork";
  IF copied <> wallets THEN
    RAISE EXCEPTION 'Registry copy mismatch: % deposit wallet(s), % copied. Nothing was changed.', wallets, copied;
  END IF;
END $$;
