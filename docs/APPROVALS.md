# Two-person approval (maker-checker)

Specification section 13. Some desk changes are too risky for one person to make alone. These are
**requested** by one staff member and **applied** only when a different staff member approves them.

| Change | Permission (to request and to approve) | Who has it today |
| --- | --- | --- |
| Change a deposit address, confirmations, or turn a network on/off | `wallets.manage` | Operations Manager, Super Admin |
| Add an asset on a new network | `wallets.manage` | Operations Manager, Super Admin |
| Credit or debit a customer's wallet by hand | `ledger.adjust` | Finance Officer, Super Admin |

Code: `src/lib/services/approvals.ts`. Desk: Admin → **Approvals**. Tests: `tests/db/approvals.test.ts`.

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

## Adding a new kind of approval

Add an entry to `APPROVAL_ACTIONS` with:

- `prepare`: validate without changing anything, and return a summary and target version;
- `currentVersion`: read the target's version now;
- `apply`: make the change.

Then point the desk action at `requestApproval` instead of the service.

## Rollback

The migration `20261126090000_approval_requests` lists its rollback in its header. Rolling back
removes the approval history. Export `ApprovalRequest` first if you need it for audit.
