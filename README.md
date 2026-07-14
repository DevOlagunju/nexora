# Nexora

Nigeria-first web + mobile platform to **buy/sell crypto and sell gift cards for Naira**. Inspired by vendors like Greatiby, with a security-first hybrid operations model.

## Stack (security-minded)

- **Next.js 16** (App Router) + TypeScript
- **Prisma 7** + SQLite locally (Postgres via Docker — see `docs/POSTGRES.md`)
- **bcrypt** password hashing (cost 12)
- **JWT + server-side session table** in HttpOnly cookies
- **AES-256-GCM** for gift card codes at rest
- **BVN/NIN**: only last 4 stored
- Zod validation, rate limits, audit logs
- Optional **Paystack** NGN transfers, **admin webhooks**, **KYC provider** stub

## Hybrid operations

| Flow | Automated | Human desk |
|------|-----------|------------|
| Accounts, rates display, order tracking | Yes | — |
| KYC review | Queue (+ optional provider) | Approve / reject |
| Crypto sell | Order + deposit address | Confirm TX, Paystack or manual payout |
| Crypto buy | Order + platform bank details | Confirm NGN pay-in, send crypto |
| Gift card sell | Encrypt + queue | Redeem / fraud check, payout |
| Rates | CoinGecko + Jeroid live mid | Admin override |

## Quick start

```bash
cd nexora
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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

## User path

1. Register → submit KYC  
2. Admin approves KYC  
3. Buy / sell crypto or sell gift card  
4. Admin verifies → marks payout / sends crypto  

## Production checklist

- [ ] Move to **PostgreSQL** (`docker compose up -d` + `docs/POSTGRES.md`)
- [ ] Replace `AUTH_SECRET` and `ENCRYPTION_KEY`
- [ ] Replace demo deposit wallet addresses + `PLATFORM_BANK_*`
- [ ] Put Redis in front of in-memory rate limits
- [ ] Wire real KYC provider keys
- [ ] Fund Paystack balance + enable Transfers
- [ ] HTTPS only, secure cookies, WAF
- [ ] Never log raw gift card codes or full BVN/NIN

## App (Android & iOS)

Expo app lives in `../nexora-mobile`.

```bash
# Terminal 1 — API reachable on LAN
cd "Project Crypto/nexora"
npm run dev

# Terminal 2 — Expo (sibling folder, not inside nexora)
cd "Project Crypto/nexora-mobile"
npx expo start
```

See `nexora-mobile/README.md` for device IP setup and EAS store builds.
