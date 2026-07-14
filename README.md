# Nexora

Nigeria-first web platform to **sell crypto and gift cards for Naira**. Inspired by vendors like Greatiby, with gift cards added and a security-first hybrid operations model.

## Stack (security-minded)

- **Next.js 16** (App Router) + TypeScript
- **Prisma 7** + SQLite locally (swap `DATABASE_URL` to Postgres for production)
- **bcrypt** password hashing (cost 12)
- **JWT + server-side session table** in HttpOnly cookies
- **AES-256-GCM** for gift card codes at rest
- **BVN/NIN**: only last 4 stored
- Zod validation, rate limits, audit logs

## Hybrid operations

| Flow | Automated | Human desk |
|------|-----------|------------|
| Accounts, rates display, order tracking | Yes | — |
| KYC review | Queue | Approve / reject |
| Crypto sell | Order + deposit address | Confirm TX, mark payout |
| Gift card sell | Encrypt + queue | Redeem / fraud check, payout |
| Rates | Seeded defaults | Admin override live |

Buy crypto / Paystack-Flutterwave / native app come later on the same API surface.

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

## User path

1. Register → submit KYC  
2. Admin approves KYC  
3. Sell crypto or gift card  
4. Admin verifies → marks payout / completed  

## Production checklist

- [ ] Move to **PostgreSQL**
- [ ] Replace `AUTH_SECRET` and `ENCRYPTION_KEY`
- [ ] Replace demo deposit wallet addresses
- [ ] Put Redis in front of in-memory rate limits
- [ ] Add BVN/NIN verification provider (DojaHub / Prembly)
- [ ] Add Paystack/Flutterwave for automated NGN payouts
- [ ] HTTPS only, secure cookies, WAF
- [ ] Never log raw gift card codes or full BVN/NIN

## App (Android & iOS)

Expo app lives in `../nexora-mobile`.

```bash
# Terminal 1 — API reachable on LAN
cd nexora
npm run dev

# Terminal 2 — Expo
cd ../nexora-mobile
npx expo start
```

See `nexora-mobile/README.md` for device IP setup and store builds.
