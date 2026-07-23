# Ship path (production)

## 1. Secrets

Copy `.env.example` → `.env` / host secrets. Replace:

- `AUTH_SECRET`, `ENCRYPTION_KEY` (long random)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- `NEXT_PUBLIC_SUPPORT_WHATSAPP` (E.164 digits, e.g. `2348012345678`)
- `PLATFORM_BANK_*`, deposit wallet addresses
- Optional: `PAYSTACK_SECRET_KEY`, `ADMIN_WEBHOOK_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`

Never commit real `.env`. Soft-launch with **staging** first (`.env.staging.example`).

## 2. Paystack test payout

1. Paystack dashboard → test secret key in env.  
2. Enable Transfers / add balance in test.  
3. Create a small sell order with KYC bank matching a test recipient.  
4. Admin → Trigger Paystack payout → confirm `PAYOUT_SENT`.  
5. Switch to live keys only after that passes.

## 3. Postgres + HTTPS

```bash
docker compose up -d
# follow docs/POSTGRES.md (switch provider + migrate)
```

Deploy Next app (Vercel/Fly/Railway) with HTTPS. Point:

```
EXPO_PUBLIC_API_URL=https://your-api-domain.com
```

## 4. Expo preview build

```bash
cd ../nexora-mobile
eas build:configure
eas build -p android --profile preview
```

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
