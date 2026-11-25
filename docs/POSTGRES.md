# Database: PostgreSQL

Nexora runs on **PostgreSQL** everywhere: local development, tests, CI and production.
SQLite is no longer supported (it has no exact decimal type and allows one writer at a time).

## Local setup

```bash
docker compose up -d postgres     # Postgres 16 on 127.0.0.1:5432
npm run db:deploy                 # apply migrations
npm run db:seed                   # rates, wallets, admin user
npm run dev
```

`.env`:

```bash
DATABASE_URL="postgresql://nexora:nexora@localhost:5432/nexora"
```

If port 5432 is already taken on your machine, set `POSTGRES_PORT=5433` in `.env` (Docker
Compose reads it) and use the same port in `DATABASE_URL`.

Docker must be running before `npm run dev` or `npm test`.

## How money is stored

Every amount is an exact `DECIMAL` column. There is no floating point in the database.

| Kind | Columns | Type |
|---|---|---|
| Naira amounts | `walletBalanceNgn`, `amountNgn`, `feeNgn`, `paidNgn` | `DECIMAL(18,2)` |
| Rates (NGN per unit) | `sellRateNgn`, `buyRateNgn`, `rateNgn`, `targetNgn` | `DECIMAL(18,4)` |
| Crypto quantities | `amountCrypto`, `minAmount`, `maxAmount` | `DECIMAL(36,18)` |
| Gift card face value | `faceValueUsd` | `DECIMAL(12,2)` |

Rules the code follows:

- **Balances change in SQL.** Credits and debits use `increment` / `decrement` and a conditional
  update, so the arithmetic is done by Postgres on exact decimals.
- **The database refuses bad money.** `CHECK` constraints reject a negative wallet balance and a
  non-positive ledger, withdrawal or payment amount, whatever the application does.
- **App code uses `src/lib/money.ts`** (`mulNgn`, `addNgn`, `subNgn`, `sumNgn`, `roundNgn`) for any
  calculation on an amount. These work in decimal and round half-up once. Do not use `+` or `*`
  on amounts.
- **Rows give amounts as numbers** (`src/lib/prisma-factory.ts`), so the JSON API and the UI are
  unchanged. This is exact for up to 15 significant digits, which covers every Naira amount.
  Crypto quantities with more than 15 significant digits are stored exactly but would be
  rounded when read into the app; nothing in the app produces such values today.
- **Aggregates are different.** `aggregate({ _sum })` returns a decimal object, not a number,
  even though the TypeScript type says number. Always pass it through `numberFrom()`.

## Migrations

`prisma/migrations/` is the Postgres history, starting from the baseline
`20261125120000_init_postgres`. The old SQLite history is kept for reference in
`prisma/migrations-sqlite/` and is never applied.

```bash
npx prisma migrate dev --name describe_the_change   # create a migration (needs a terminal)
npm run db:deploy                                   # apply in staging / production
```

Every schema change needs a reviewed migration and a written way back.

## Tests

`npm test` needs Postgres. It builds a migrated template database (`nexora_test_template`) and
gives each file under `tests/db/` its own clone (`nexora_test_w...`), dropped at the end. The
development database is never touched. Set `TEST_DATABASE_URL` to use a different server.

## Moving old SQLite data

```bash
npx tsx scripts/sqlite-to-postgres.mts path/to/old.db
```

Copies every table into an **empty** Postgres database in one transaction, rounds money to the
column scale, and checks row counts and every wallet balance. Keep `ENCRYPTION_KEY` unchanged or
copied gift-card codes cannot be decrypted.

## Rolling back

The switch from SQLite to Postgres (25 Nov 2026) can be undone while no new data matters:

1. Stop the app.
2. Restore `prisma/schema.prisma`, `src/lib/prisma-factory.ts`, `src/lib/db.ts` and
   `src/lib/money.ts` from before the change, and move `prisma/migrations-sqlite/` back to
   `prisma/migrations/`.
3. Set `DATABASE_URL="file:./prisma/dev.db"`. The SQLite file was not modified; a copy from the
   moment of the switch is in `backups/dev-pre-postgres-20261125.db`.
4. `npx prisma generate`.

Anything written to Postgres after the switch is not carried back by these steps.

## Backups

`npm run db:backup` runs `pg_dump` (needs the Postgres client tools on PATH). Prefer your
provider's managed point-in-time recovery for production, and test a restore.
