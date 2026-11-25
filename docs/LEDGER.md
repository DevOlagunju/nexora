# Ledger

Customer money is tracked in a double-entry ledger. A balance is never a number someone
typed or code "updated": it is the running total of ledger entries, kept by the database.

## The three tables

| Table | What it is |
|---|---|
| `LedgerAccount` | One account in the chart of accounts. `balance` is maintained by the database. |
| `LedgerTransaction` | One financial event, with a unique `reference`, a `kind` and a `source`. |
| `LedgerEntry` | A debit or credit of one account, belonging to one transaction. |

`WalletEntry` remains as the customer's statement (the wording they see). It is written in the
same database transaction as the ledger posting and carries the same `reference`.
`User.walletBalanceNgn` is a copy of the customer's ledger account balance, kept in step by a
database trigger so existing screens and the API read it unchanged.

## Rules the database enforces

These hold whatever the application does (see the `double_entry_ledger` migration):

1. **Every transaction balances.** Debits must equal credits, checked when the database
   transaction commits. An unbalanced or empty transaction is rejected.
2. **Posted rows are immutable.** A `LedgerTransaction` or `LedgerEntry` cannot be updated or
   deleted, and entries cannot be added to a transaction after it is posted.
3. **Balances only move through entries.** `LedgerAccount.balance` and `User.walletBalanceNgn`
   cannot be set directly.
4. **A customer balance cannot go negative.**

A mistake is corrected by posting a new transaction that reverses the old one
(`reversesId` links them). History is never edited.

## Chart of accounts

| Code | Type | Meaning |
|---|---|---|
| `customer:<userId>:NGN` | Liability | What Nexora owes that customer |
| `asset:provider_clearing:NGN` | Asset | Money held at the payment gateway |
| `asset:bank:NGN` | Asset | Operating bank account |
| `liability:payout_clearing:NGN` | Liability | Withdrawals requested but not yet paid |
| `liability:trading_settlement:NGN` | Liability | Naira side of crypto and gift card trades |
| `revenue:fees:NGN` | Revenue | Fees earned |
| `expense:referral_bonus:NGN` | Expense | Referral bonuses paid |
| `equity:adjustments:NGN` | Equity | Opening balances and approved adjustments |

## What each event posts

| Event | Debit | Credit |
|---|---|---|
| Naira deposit (gateway) | provider clearing | customer |
| Crypto purchase from wallet | customer | trading settlement |
| Purchase refund | trading settlement | customer |
| Sale proceeds to wallet | trading settlement | customer |
| Withdrawal requested (amount + fee) | customer | payout clearing |
| Withdrawal cancelled / failed | payout clearing | customer |
| Withdrawal paid | payout clearing | provider clearing or bank, and fee revenue |
| Referral bonus | referral expense | customer |
| Sale paid straight to a bank account (on Completed) | trading settlement | provider clearing or bank |
| Purchase paid by bank transfer (on Completed) | bank | trading settlement |

**This mapping must be confirmed by finance** against the real custody, settlement and legal
set-up before launch. It lives in `src/lib/ledger/accounts.ts`.

## Not yet in the ledger

- **A bank payout still in flight.** An order paid outside the wallet is posted once, when it
  reaches Completed. Between "Payout sent" and "Completed" it is not in the ledger.
- **Treasury movements.** Moving money between the operating bank and the payment provider
  (topping up the provider balance, or the provider settling collections to the bank) is not
  recorded. Until it is, `asset:bank` and `asset:provider_clearing` show net activity, not the
  real balances, and `provider_clearing` can read negative.
- **Trading fees and spread** are not booked as revenue: orders are priced at a single desk rate.
- **Reconciliation against the provider's and the bank's own records.** The check below
  compares the ledger with Nexora's own records only.
- **Rows created outside the ledger** (seeded or imported withdrawals) are listed as notes by
  the check rather than reconciled.

## Checking it

```bash
npm run ledger:check
```

Reconciles the ledger against itself and against the wallet records, prints the system
account balances, and exits 1 if anything disagrees. The same check runs on every
`/api/cron/reconcile-payments` call and alerts the admin webhook on a finding. A finding is
never repaired automatically.

## Writing code that moves money

Use `creditWallet` / `debitWallet` in `src/lib/services/wallet.ts` with the right `kind`, inside
the same `prisma.$transaction` as the business change. For anything else, `postLedger` in
`src/lib/services/ledger.ts`. Never write to a ledger table or a balance directly.
