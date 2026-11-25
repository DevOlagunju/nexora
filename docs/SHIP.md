# Ship path (production)

## 1. Secrets

Copy `.env.example` → `.env` / host secrets. Replace:

- `AUTH_SECRET`, `ENCRYPTION_KEY` (long random)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- `NEXT_PUBLIC_SUPPORT_WHATSAPP` (E.164 digits, e.g. `2348012345678`)
- `PLATFORM_BANK_*`, deposit wallet addresses
- Optional: `PAYSTACK_SECRET_KEY`, `ADMIN_WEBHOOK_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`

Generate secrets with `npm run secrets:generate`. Production **refuses to start** if
`AUTH_SECRET` / `ENCRYPTION_KEY` are missing or still the example values (see `src/lib/env.ts`);
other gaps (no Redis, SQLite, test Paystack key, no email) are logged as warnings at boot.

Never commit real `.env`. Soft-launch with **staging** first (`.env.staging.example`).

> Rotating `ENCRYPTION_KEY` makes existing gift-card codes undecryptable. Settle or re-key
> open gift orders before changing it.

## 2. Paystack test payout

1. Paystack dashboard → test secret key in env.  
2. Enable Transfers / add balance in test.  
3. Create a small sell order with KYC bank matching a test recipient.  
4. Admin → Trigger Paystack payout → confirm `PAYOUT_SENT`.  
5. Paystack dashboard -> Webhooks -> `https://<domain>/api/webhooks/paystack`.
   `transfer.success` moves the order to `COMPLETED`; `transfer.failed` / `reversed` moves it back
   to `APPROVED`, clears the payout ref, adds a desk note and fires `ADMIN_WEBHOOK_URL`.
6. Switch to live keys only after that passes.

## 3. Postgres + HTTPS

```bash
docker compose up -d postgres
# follow docs/POSTGRES.md (switch provider + migrate)
```

Deploy with HTTPS on any of:

- **Docker** (Fly, Railway, Render, a VPS): `Dockerfile` builds a slim standalone image with a
  `/api/health` healthcheck. `docker compose --profile app up -d --build` runs
  postgres -> `migrate` (prisma migrate deploy) -> app, reading `.env.production`.
- **Vercel**: works as-is; run `npm run db:deploy` against the prod DB in your release step.

After every deploy: `npm run smoke -- https://your-domain`.

Point:

```
EXPO_PUBLIC_API_URL=https://your-api-domain.com
```

## 4. Expo preview build

```bash
cd ../nexora-mobile
eas build:configure                      # sets the real projectId
npm run env:preview -- --value https://staging.your-domain.com
npm run env:production -- --value https://api.your-domain.com
eas build -p android --profile preview
```

Release builds **require** an `https://` `EXPO_PUBLIC_API_URL`; without it the app shows a clear
config error instead of silently calling a LAN/emulator address.

Install APK on devices for soft launch.

## 5. Soft launch

- Known users only; low desk caps in env.  
- Ops follow `docs/OPS.md`.  
- Watch `/admin` + webhook.  
- Run `npm run db:backup` daily until automated.

## Cron (optional)

```
GET /api/cron/sync-rates
Authorization: Bearer $CRON_SECRET
```

Schedule hourly. Safe against CoinGecko 429 (uses Binance/Coinbase fallbacks).
