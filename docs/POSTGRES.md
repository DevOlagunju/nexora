# PostgreSQL production path

Local development stays on **SQLite**. For production:

## 1. Start Postgres

```bash
docker compose up -d
```

Default URL: `postgresql://nexora:nexora@localhost:5432/nexora`

## 2. Install adapters

```bash
npm install @prisma/adapter-pg pg
npm install -D @types/pg
```

## 3. Switch Prisma datasource

In `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
}
```

## 4. Env + migrate

```env
DATABASE_URL="postgresql://nexora:nexora@localhost:5432/nexora"
```

```bash
npx prisma migrate deploy
npm run db:seed
```

`src/lib/db.ts` already picks the Postgres adapter when `DATABASE_URL` starts with `postgres`.
