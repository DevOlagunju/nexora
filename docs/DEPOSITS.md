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

## Real deposits: SHKeeper

[SHKeeper](https://shkeeper.io) is free, open-source (GPL-3.0) software you run on your own server.
It holds the wallet keys, issues addresses and calls Nexora back when crypto arrives. Nexora talks to
it over its API, so its licence does not apply to Nexora's code. Code: `src/lib/deposits/shkeeper.ts`.

### Setting it up

1. **Server.** SHKeeper runs on Linux with Kubernetes (k3s). On public blockchain nodes it needs about
   8 CPU cores, 8 GB RAM and a 200 GB SSD; running your own nodes for every chain needs far more. Follow
   SHKeeper's install guide, put it behind https (e.g. `https://pay.yourdomain.com`), and turn on the
   coins you sell. Use test networks first.
2. **Keys.** Back up every wallet's seed phrase offline. Set auto-withdrawal to sweep funds to a cold
   wallet often, so little sits on the server. Have someone review the server's security before real
   money goes through it.
3. **API key.** SHKeeper admin → Wallets → Manage → API key (the same key for every wallet).
4. **Nexora's environment:**

   ```
   DEPOSIT_PROVIDER="shkeeper"
   SHKEEPER_URL="https://pay.yourdomain.com"
   SHKEEPER_API_KEY="..."
   NEXT_PUBLIC_APP_URL="https://yourdomain.com"
   # SHKEEPER_WEBHOOK_SECRET="..."  only if your SHKeeper signs callbacks with a separate secret
   ```

   The app refuses to start in production if any of these are missing or SHKEEPER_URL isn't https.
5. **Coin names.** Nexora maps its assets to SHKeeper's coin names as follows. Compare them with
   `GET https://pay.yourdomain.com/api/v1/crypto` and correct or add any with
   `SHKEEPER_CRYPTO_NAMES="SYMBOL/NETWORK=NAME,..."`.

   | Nexora | SHKeeper |
   |---|---|
   | BTC on BTC | `BTC` |
   | ETH / USDT / USDC on ERC20 | `ETH` / `ETH-USDT` / `ETH-USDC` |
   | BNB / USDT / USDC on BEP20 | `BNB` / `BNB-USDT` / `BNB-USDC` |
   | TRX / USDT / USDC on TRC20 | `TRX` / `USDT` / `USDC` (check these on your install) |

6. **Test it.** On test networks: open the sell screen as a customer (an address is issued), send test
   coins to it, and watch Admin → Deposits.

### How it works

- Each customer's address for one asset on one network is a permanent SHKeeper invoice with
  external id `nexora:<userId>:<SYMBOL>:<NETWORK>`. SHKeeper gives back the same address every time.
  The invoice amount is nominal: Nexora ignores SHKeeper's PAID/PARTIAL status and matches each
  transaction to an order itself, exactly as above.
- SHKeeper calls `POST /api/v1/webhooks/shkeeper`. Nexora checks the `X-Shkeeper-Signature` HMAC
  (SHA-256 over `<timestamp>.<raw body>`) and refuses anything older than 5 minutes.
- **Nexora then asks SHKeeper's API about each transaction** (`GET /api/v1/invoices/<external id>`)
  and only acts once SHKeeper shows it as `CONFIRMED`, using SHKeeper's amount. Until then the callback
  is answered with an error, and SHKeeper sends it again a minute later. SHKeeper applies its own
  confirmation thresholds; Nexora records the deposit with the registry's count.
- If SHKeeper can't be reached, the sell screen shows the desk's shared address. Placing an order
  refuses with "try again in a few minutes" rather than give out an address nobody watches.
- A transaction SHKeeper doesn't know about (a forged callback) is never credited. Its callback keeps
  failing and is recorded in `WebhookEvent` with the error.

## Adding another provider

Implement `DepositProvider` in `src/lib/deposits/provider.ts`:

- `createAddress`, `verifyWebhook` and `parseWebhook`;
- optionally `confirmEvent`, to re-check with the provider's API.

Then register its name. Matching, confirmations, exceptions and the desk screens do not change.

## Not yet done

- **Polling the provider** for deposits whose webhook never arrived. SHKeeper retries a failed
  callback every minute, but nothing yet asks it about callbacks that were never sent.
- **Sweeping** customer addresses into a treasury wallet (set up auto-withdrawal in SHKeeper).
- **Reorganisations with SHKeeper.** It reports confirmed transactions only, so `REVERSED` comes only
  from providers that report dropped transfers.
- **Automatic approval** of credited deposits: every order still waits for the desk.
- **Crypto sent out** on buy orders is still sent by hand.
