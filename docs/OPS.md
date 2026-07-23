# Nexora desk operations checklist

Hybrid model: automation creates orders + rates; humans confirm money movement.

## Roles

| Role | Who | Does |
|------|-----|------|
| Customer | App / web user | KYC, create order, send crypto / pay NGN / submit card |
| Desk ops | Admin on `/admin` | Verify, approve, pay out, mark COMPLETED |
| Manager | You | Limits, wallets, Paystack, escalations |

## Crypto sell (customer → you crypto, you → customer NGN)

1. Customer creates order → status `AWAITING_DEPOSIT` (deposit address shown).
2. Customer sends crypto → pastes TX hash → `UNDER_REVIEW`.
3. Desk: open explorer, confirm amount + network + destination wallet (use **wallet allowlist note**).
4. Desk: set status `APPROVED` when TX is good.
5. Desk: pay NGN (Paystack checkbox or manual bank) → `PAYOUT_SENT` + payout ref.
6. Desk: after bank settles → `COMPLETED`.
7. If bad TX / mismatch → `REJECTED` + clear admin note (customer sees Contact support).

## Crypto buy (customer → you NGN, you → customer crypto)

1. Order created → pay into `PLATFORM_BANK_*`.
2. Customer submits payment ref → `UNDER_REVIEW`.
3. Desk: confirm NGN credit in bank.
4. Desk: send crypto to `userReceiveAddress` on correct network.
5. Mark `COMPLETED` (or `PAYOUT_SENT` then `COMPLETED`).

## Gift card sell

1. Code stored encrypted → `UNDER_REVIEW`.
2. If **Fraud flag** shown: verify code offsite before payout.
3. Redeem / confirm valid → payout NGN → `PAYOUT_SENT` → `COMPLETED`.
4. Invalid / already used → `REJECTED` + note.

## KYC

1. Customer submits (BVN/NIN last-4 only stored).
2. Desk approve/reject on `/admin` KYC queue.
3. Trading blocked until `APPROVED`.

## Daily habit

- [ ] Clear KYC queue  
- [ ] Clear crypto + gift under review  
- [ ] Sync live crypto rates if desk mid drifted (or rely on cron)  
- [ ] `npm run db:backup` (or scheduled backup)  
- [ ] Check Paystack balance / transfer failures  
