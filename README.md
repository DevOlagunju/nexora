# Nexora

Nigeria-first web + mobile platform to **buy/sell crypto and sell gift cards for Naira**. Inspired by vendors like Greatiby, with a security-first hybrid operations model.

## Stack (security-minded)

- **Next.js 16** (App Router) + TypeScript
- **Prisma 7** + PostgreSQL, money stored as exact decimals (local database via Docker  -  see `docs/POSTGRES.md`)
- **bcrypt** password hashing (cost 12)
- **JWT + server-side session table** in HttpOnly cookies
- **AES-256-GCM** for gift card codes at rest
- **BVN/NIN**: only last 4 stored
- Zod validation, rate limits, audit logs
- Optional **Paystack** NGN transfers, **admin webhooks**, **KYC provider** stub

## Hybrid operations

| Flow | Automated | Human desk |
|------|-----------|------------|
| Accounts, rates display, order tracking | Yes | n/a |
| KYC review | Queue (+ optional provider) | Approve / reject |
| Crypto sell | Order + deposit address | Confirm TX, Paystack or manual payout |
| Crypto buy | Order + **instant payment confirmation** (card / transfer / USSD via gateway, or wallet balance) | Send crypto (manual bank transfers still need a pay-in check) |
| Wallet top-up | Gateway checkout, verified with the provider, credited instantly | n/a |
| Gift card sell | Encrypt + queue | Redeem / fraud check, payout |
| Rates | CoinGecko + Jeroid live mid | Admin override |

## Quick start

```bash
cd nexora
npm install
cp .env.example .env        # then: npm run secrets:generate and paste the values
npx prisma migrate dev
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project layout

```
src/
  app/                 Next.js routes (pages, server actions, /api/*)
    actions.ts         Web server actions - thin adapters over services
    api/auth           Mobile/JSON auth (bearer tokens)
    api/mobile         Mobile dashboard + trade actions
    api/health         Liveness/readiness probe (DB ping)
    api/webhooks/paystack  Transfer success/failure -> order status
    api/cron/sync-rates    Hourly desk rate sync (Bearer CRON_SECRET)
  lib/
    services/          Domain logic shared by web + mobile (accounts, kyc, trades, desk)
    order-status.ts    Order state machine (enforced on every desk update)
    env.ts             Env contract; production refuses to boot with unsafe values
    security.ts        Rate limiting (Upstash Redis or memory) + audit log
  proxy.ts             CORS for /api (Next 16 "proxy", formerly middleware)
  instrumentation.ts   Boot-time env check + central server error logging
tests/                 Vitest unit tests
scripts/               backup-db, smoke (post-deploy), set-admin-password
```

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server on `0.0.0.0:3000` (reachable from phones on LAN) |
| `npm run check` | Lint + typecheck + unit tests (what CI runs before build) |
| `npm test` | Unit tests (Vitest) |
| `npm run build` / `start` | Production build / server |
| `npm run db:migrate` / `db:deploy` | Create migration (dev) / apply migrations (prod) |
| `npm run db:seed` | Admin user, rates, deposit wallets |
| `npm run db:seed-demo` | Local demo customers for UI review (`-- --remove` deletes them; refuses in production) |
| `scripts/flow-check.mts` | Money-flow check (wallet credit, PIN, withdrawals, refunds, referrals, alerts, instant payments) against a **copy** of the DB: `cp prisma/dev.db prisma/flow-check.db` then `DATABASE_URL=file:./prisma/flow-check.db npx tsx --conditions=react-server scripts/flow-check.mts` |
| `npm run db:backup` | SQLite online backup or `pg_dump` (`BACKUP_KEEP=14` prunes) |
| `npm run smoke -- <url>` | Read-only post-deploy checks against a live URL |
| `npm run secrets:generate` | Print fresh `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` |
| `npm run admin:password` | Reset admin password from `ADMIN_PASSWORD` |

### Admin account

Copy `.env.example` → `.env`, set `ADMIN_EMAIL` / `ADMIN_PASSWORD`, then run `npm run db:seed`.
Change those secrets before any production use.

### Optional env

| Variable | Purpose |
|----------|---------|
| `PLATFORM_BANK_*` | NGN account shown on buy-crypto |
| `PAYSTACK_SECRET_KEY` | Auto NGN payouts from admin desk |
| `ADMIN_WEBHOOK_URL` | Slack/Discord alerts on orders/KYC |
| `KYC_PROVIDER` / `KYC_API_KEY` | Prembly/Dojah-style hook (default: manual) |
| `RESEND_API_KEY` / `NOTIFY_FROM_EMAIL` | Password reset + order emails |
| `NEXT_PUBLIC_APP_URL` | Link base in reset emails (e.g. https://nexora.ng) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Shared rate limits across instances (recommended in prod) |
| `CORS_ALLOWED_ORIGINS` | Comma list of browser origins allowed to call `/api` |

## User path

1. Register → submit KYC  
2. Admin approves KYC  
3. Buy / sell crypto or sell gift card  
4. Admin verifies → marks payout / sends crypto  

## Production checklist

Done in code (verify on staging with `npm run smoke -- https://staging...`):

- [x] Boot-time env validation - example secrets block production start
- [x] Security headers (HSTS, frame-ancestors, nosniff, referrer, permissions)
- [x] Order state machine + double-payout DB lock on Paystack triggers
- [x] Paystack transfer webhook closes payouts (success -> COMPLETED, failure -> back to APPROVED)
- [x] Instant payment confirmation: `charge.success` webhook + return page + app poll + reconcile cron, all re-verified with `/transaction/verify` and idempotent (`src/lib/services/payments.ts`, provider layer in `src/lib/payments/gateway.ts`)
- [x] Shared rate limiting via Upstash Redis (memory fallback)
- [x] `/api/health`, Dockerfile, CI (lint, typecheck, tests, migrations, build, image)

You still need to:

- [ ] Follow **`docs/SHIP.md`** (secrets -> Paystack test -> Postgres -> Expo)
- [ ] Desk ops playbook: **`docs/OPS.md`**
- [x] **PostgreSQL** with exact decimal money columns (`docs/POSTGRES.md`)
- [ ] Generate real `AUTH_SECRET` / `ENCRYPTION_KEY` (`npm run secrets:generate`)
- [ ] Replace demo deposit wallet addresses + `PLATFORM_BANK_*` + WhatsApp support number
- [ ] Set `UPSTASH_REDIS_REST_*`, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`
- [ ] Wire real KYC provider keys (`src/lib/kyc-provider.ts` is a stub)
- [ ] Fund Paystack balance, enable Transfers, register the webhook URL (it now also confirms customer payments)
- [ ] Schedule `GET /api/cron/reconcile-payments` every 1-5 min (catches missed webhooks)
- [ ] Schedule `GET /api/cron/sync-rates` + `npm run db:backup`
- [ ] Never log raw gift card codes or full BVN/NIN

## App (Android & iOS)

Expo app lives in `../nexora-mobile`.

```bash
# Terminal 1  -  API reachable on LAN
cd "Project Crypto/nexora"
npm run dev

# Terminal 2  -  Expo (sibling folder, not inside nexora)
cd "Project Crypto/nexora-mobile"
npx expo start
```

See `nexora-mobile/README.md` for device IP setup and EAS store builds.
