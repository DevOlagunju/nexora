# Blockchain deposits

Customers selling crypto send it to **their own deposit address**. A deposit provider watches those
addresses and tells Nexora by webhook when crypto arrives. Nexora waits for the confirmations the
network needs, matches the deposit to the customer's sell order and sends the order to the desk.
Nobody pastes a transaction hash, and nothing is paid out automatically: the desk still approves.

## The flow

1. **Address.** The first time a customer sells an asset on a network (or opens the sell screen),
   the provider issues them an address. It never changes. Without a provider, orders use the
   desk's shared address from the registry, as before.
2. **Webhook.** `POST /api/v1/webhooks/<provider>`. Every webhook is **stored before it is
   processed** (`WebhookEvent`). A repeated delivery is recognised and skipped. A webhook with a
   bad signature is kept for investigation and never acted on.
3. **Confirmations.** The deposit stays `PENDING` until it has the confirmations set for that
   asset and network (Admin → Assets and networks). The customer is told it was seen.
4. **Matching.** Once confirmed, it pays the customer's oldest open sell order for that asset and
   network whose amount matches (within 0.1%, `DEPOSIT_AMOUNT_TOLERANCE_PCT`), else their oldest
   open order. The order moves to **Under review** with the transaction hash recorded.

## Exceptions (Admin → Deposits)

| Status | Meaning |
|---|---|
| `UNDERPAID` / `OVERPAID` | Matched to an order, but the amount differs. The order still goes to the desk. |
| `UNMATCHED` | No open order to pay, or sent to an address that belongs to no customer. |
| `WRONG_ASSET` | A different coin arrived at the address (e.g. USDC at a USDT address). |
| `REVERSED` | The transfer left the chain (reorganisation). An order not yet approved goes back to waiting. |

A person closes each one with a note ("Mark resolved"), which is audited. An order is never paid
by two deposits.

A deposit sent on the **wrong network** (e.g. BEP20 to a TRC20 address) never reaches the
address, so no provider can report it. The customer has to contact support.

## Testing for free: the simulated provider

Outside production, the **simulated provider** is on by default. It issues addresses with the right
shape for each network and is driven from **Admin → Deposits → Test a deposit**:

1. Create a sell order as a customer; copy its deposit address.
2. Simulate a deposit with fewer confirmations than the network needs: it shows as `PENDING`.
3. Send it again with the same transaction hash and enough confirmations: the order moves to
   Under review.
4. Try a different amount, a second deposit, or "Dropped from the chain" to see each exception.

The simulated provider is refused in production (the app will not start with
`DEPOSIT_PROVIDER=simulated`), and its addresses belong to nobody: never send real funds to them.
`DEPOSIT_PROVIDER=none` switches deposits off and uses the shared desk address.

## Adding a real provider

Implement `DepositProvider` in `src/lib/deposits/provider.ts` (`createAddress`, `verifyWebhook`,
`parseWebhook`) for Blockradar, Fireblocks or another, and register its name. Matching,
confirmations, exceptions and the desk screens do not change.

## Not yet done

- **Polling the provider** for deposits whose webhook never arrived.
- **Sweeping** customer addresses into a treasury wallet (the provider does this).
- **Automatic approval** of credited deposits: every order still waits for the desk.
- **Crypto sent out** on buy orders is still sent by hand.
