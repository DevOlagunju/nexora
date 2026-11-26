# Two-person approval (maker-checker)

Specification section 13. Some desk changes are too risky for one person to make alone. These are
**requested** by one staff member and **applied** only when a different staff member approves them.

| Change | Permission (to request and to approve) | Who has it today |
| --- | --- | --- |
| Change a deposit address, confirmations, or turn a network on/off | `wallets.manage` | Operations Manager, Super Admin |
| Add an asset on a new network | `wallets.manage` | Operations Manager, Super Admin |
| Credit or debit a customer's wallet by hand | `ledger.adjust` | Finance Officer, Super Admin |
| Give, change or remove someone's staff access | `staff.manage` | Super Admin |

Code: `src/lib/services/approvals.ts`. Desk: Admin → **Approvals**. Tests: `tests/db/approvals.test.ts`,
`tests/db/staff-roles.test.ts`, `tests/db/staff-last-admin.test.ts`.

## Rules

- **Nobody approves their own request.** The service refuses it, and the database has a CHECK
  constraint (`decidedById <> requestedById`) so it cannot happen even through a bug or a script.
- The approver needs the same permission as the change. A Finance Officer cannot approve a deposit
  address; an Operations Manager cannot approve a wallet adjustment.
- A request is **checked when it is made**. An invalid address or a debit larger than the balance is
  refused straight away, so nothing broken sits waiting for approval.
- If the thing being changed was **edited after the request**, approving fails (status `FAILED`) and
  nothing is applied. The approver would otherwise be approving something they didn't see.
- Requests **expire after 72 hours**. The requester can cancel their own pending request.
- Approving a wallet adjustment needs a note saying what the approver checked.
- Two people clicking Approve at the same time cannot apply a change twice. The decision is claimed with
  a conditional update first, and each adjustment posts with the ledger reference `adj:<requestId>`.
- Every request, approval, rejection, failure and cancellation is written to the audit log.

## Wallet adjustments

These are corrections, not a way to pay people. Pick a reason (payout failed outside the system, duplicate
charge, missed credit, goodwill, desk error) and write what happened, with the order reference. Once
approved, the adjustment is posted through the double-entry ledger as kind `adjustment`. It shows in the
customer's wallet history and they get a notification. A debit can never take a wallet below zero.
Anything above ₦10,000,000 is refused and must be handled by finance directly.

## Staff access

Requested on Admin → **Staff**, approved under **Approvals** by a different Super Admin.

- The person needs an account first. They can sign up in the app, then a Super Admin gives that account a role.
- An account that has traded, withdrawn or holds money can't become staff. Staff use a separate account, so
  nobody works the desk on their own trades.
- The last Super Admin can never be removed or demoted. This is checked when the request is made and again
  inside the transaction that applies it, with every Super Admin row locked, so two removals approved at the
  same moment can't both go through.
- Removing staff access signs the person out everywhere. A role change takes effect on their next click.
- If someone's access was changed another way after the request (for example with the script below),
  approving fails and nothing is applied.
- Break-glass: with a single Super Admin nobody can approve, so the second one is added on the server with
  `npm run admin:role -- email SUPER_ADMIN`. That script also writes to the audit log.

## Adding a new kind of approval

Add an entry to `APPROVAL_ACTIONS` with:

- `prepare`: validate without changing anything, and return a summary and target version;
- `currentVersion`: read the target's version now;
- `apply`: make the change.

Then point the desk action at `requestApproval` instead of the service.

## Rollback

The migration `20261126090000_approval_requests` lists its rollback in its header. Rolling back
removes the approval history. Export `ApprovalRequest` first if you need it for audit.
