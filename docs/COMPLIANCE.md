# Compliance controls

What the platform enforces on its own, and where staff can check it.

## Customer limits

All limits reset at midnight in Lagos (WAT). They are set in the environment, so changing one
means a deploy rather than a desk click. That's deliberate: nobody can quietly raise a limit from the
admin console.

| Limit | Default | Variable |
|---|---|---|
| Crypto sold per day | ₦5,000,000 | `DAILY_CRYPTO_SELL_LIMIT_NGN` |
| Crypto bought per day | ₦5,000,000 | `DAILY_CRYPTO_BUY_LIMIT_NGN` |
| Gift cards sold per day | ₦2,000,000 | `DAILY_GIFT_SELL_LIMIT_NGN` |
| Orders per day | 25 | `DAILY_ORDER_COUNT_LIMIT` |
| Smallest withdrawal | ₦1,000 | `WALLET_MIN_WITHDRAWAL_NGN` |
| Largest single withdrawal | ₦2,000,000 | `WALLET_MAX_WITHDRAWAL_NGN` |
| Withdrawn per day | ₦5,000,000 | `WALLET_DAILY_WITHDRAWAL_LIMIT_NGN` |
| Withdrawals per day | 5 | `WALLET_DAILY_WITHDRAWAL_COUNT` |

- Withdrawal limits count the amount the customer asked for, not the fee. Failed and cancelled
  withdrawals don't count, because their money went back to the wallet.
- The daily withdrawal check runs inside the same database transaction as the debit, after the
  customer's ledger account is locked. Requests sent at the same moment queue there, so two of them
  can't both squeeze under the limit (tested in `tests/db/wallet-ledger.test.ts`).
- The wallet's "max you can withdraw" already takes what is left of today's limit into account.
- KYC must be `APPROVED` before a customer can trade, add money or withdraw. Withdrawals only go to
  the bank account verified in KYC, and each one needs the transaction PIN.
- Gift card orders are flagged for the desk (not rejected) when the face value is high, or when
  the same brand or many cards arrive in a short time (`src/lib/trade-limits.ts`).

## Staff access

**Admin → Staff** (`/admin/staff`) lists everyone with staff access, what each role may do, and
any staff changes waiting for approval. Giving, changing or removing access needs two Super
Admins (one asks, a different one approves). Staff must use an account that has never traded. See
`docs/APPROVALS.md` for the rules.

## Audit trail

**Admin → Audit Trail** (`/admin/audit`) lists every recorded event, newest first: sign-ins and
failed sign-ins, password and PIN changes, orders, withdrawals, KYC submissions and reviews, rate
and address changes, payouts, gift card code reveals, refused staff actions and two-person
approvals.

- Filters: staff actions, customer activity, security events, and system and provider events.
- Search matches the person's name or email, the action, or the stored details, so an order or
  withdrawal reference finds all of its events.
- IP addresses are never stored, only a SHA-256 hash, so the same address can be matched without
  keeping it.
- Super Admins, Operations Managers, Compliance Officers and Auditors can open it
  (`audit.view` in `src/lib/permissions.ts`).

### Entries can't be changed

The database refuses to edit, delete or truncate audit rows (migration
`20261126110000_audit_log_append_only`), the same way it protects the ledger. The one change it
allows is the link to a person being cleared when that person's account is deleted; the event
itself stays. Tested in `tests/db/audit.test.ts`.

### Rollback

The migration lists its rollback statements in its header. Rolling back removes the protection
and the indexes but no data.
