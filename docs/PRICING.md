# Pricing and fees

Nexora follows the model its Nigerian competitors publish: **no trading fee; the margin is built
into the rate**, and a flat fee on Naira withdrawals.

## What competitors publish (checked 25 November 2026)

| | Trading fee | Naira withdrawal | Crypto sent out | Spread |
|---|---|---|---|---|
| **Jeroid** ([terms](https://www.jeroid.co/legal/terms), updated 16 June 2026) | None ("All other transactions: free") | ₦100 flat | The blockchain network fee | Not published; rates shown in-app |
| **BennyBit** ([usebennybit.com](https://usebennybit.com/)) | Says "no hidden fees" | Not published | Not published | Not published |

Neither publishes the size of its spread. Compare their in-app rates with the market mid to
calibrate Nexora's.

## How Nexora prices

- **Crypto.** Each asset has a **sell spread** and a **buy spread** (percent, set on
  Admin → Rates). Syncing from the market sets
  `sell = market mid × (1 − sell spread)` and `buy = market mid × (1 + buy spread)`, and records the
  market mid and when it was taken. Default spread: 1% each way, the specification's own example.
  The desk can still type a rate by hand; the next sync recomputes it from the spread.
- **Gift cards.** Priced per brand, country and card type (docs/GIFTCARDS.md); the margin is the
  gap between what the desk pays and what the card redeems for.
- **Trading fee.** None. Quotes carry `feeNgn: 0`; what the quote shows is what the customer gets.
- **Naira withdrawals.** ₦100 flat, charged on top (`WALLET_WITHDRAWAL_FEE_NGN`), booked as fee
  revenue in the ledger when the withdrawal is paid.

Public pages show the live market mid next to Nexora's real desk rates.

Every rate and spread change is in the audit log with its old and new value.

## Earnings report

**Admin → Earnings** (permission `reports.view`: Super Admin, Operations Manager, Finance Officer,
Auditor) shows today, the last 7 days and the last 30 days, for completed trades:

- **Crypto spread:** each order records the market mid at the time (its quote's, else the last
  sync). Earned = (market − rate) × amount on a customer sell, (rate − market) × amount on a buy.
- **Gift cards:** the desk enters what it got for each card ("Redeemed or sold for") on the order.
  Earned = that − what the customer was paid.
- **Fees:** what the ledger booked to fee revenue.

Trades whose earning can't be worked out (orders from before this change, or a gift card with no
redemption value yet) are counted and flagged, never guessed. These are expected earnings at the
market price of each trade; what the desk realises depends on when it trades the asset on, and
provider costs (payment gateway, exchange and network fees) are not taken off yet.

## Not yet done

- **Network fee on crypto sent out** (Jeroid passes it on). Today the desk absorbs it.
- **Spread as revenue in the ledger.** The spread is earned when the desk trades the crypto on,
  which happens outside Nexora; only fees are booked.
- **Rate sync covers USDT, BTC and ETH**, the assets the market feed provides.
