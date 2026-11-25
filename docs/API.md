# Nexora API v1

Versioned REST API used by the mobile app. The older endpoints (`/api/auth`, `/api/mobile`) keep
working unchanged; new client work should use `/api/v1`.

## Conventions

| | |
|---|---|
| Base path | `/api/v1` |
| Auth | `Authorization: Bearer <token>` from login/register (the web session cookie also works) |
| Success | `200` / `201` with `{ "data": ..., "message"?: "..." }` |
| Failure | `4xx` / `5xx` with `{ "error": { "code": "not_found", "message": "..." } }` |
| Money | Naira as JSON numbers with at most 2 decimals. Stored as exact decimals (docs/POSTGRES.md). |
| Tracing | Every response carries `X-Request-Id`. Send your own to have it echoed and logged. |

Error codes: `bad_request` `unauthorized` `forbidden` `not_found` `conflict` `unprocessable`
`locked` `rate_limited` `internal_error` `upstream_error` `unavailable`, plus the idempotency
codes below.

Prices are never sent by the client. An order is priced on the server from the desk rate at
the moment it is created.

## Idempotency keys

Requests that create something must send `Idempotency-Key`: a unique value per attempt
(8-128 characters: letters, digits, `- _ : .`), reused when the same attempt is retried.

| Situation | Result |
|---|---|
| Same key, same request, already finished | The first response again, with `Idempotent-Replay: true` |
| Same key, same request, still running | `409 request_in_progress` |
| Same key, different request | `422 idempotency_key_reused` |
| No key | `400 idempotency_key_required` |

A new attempt (for example after a wrong PIN) needs a new key. Rate-limit (`429`) and server
errors are not stored and may be retried with the same key. Keys are kept for 24 hours.

Required on: `POST /crypto/orders`, `POST /crypto/orders/:id/checkout`, `POST /giftcards/orders`,
`POST /deposits`, `POST /withdrawals`.

## Routes

**Auth**

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{ fullName, email, phone, password, referralCode? }` → `{ user, token }` |
| POST | `/auth/login` | `{ email, password }` → `{ user, token }` |
| POST | `/auth/logout` | Ends this session |
| DELETE | `/auth/sessions` | Signs out everywhere |
| PUT | `/auth/password` | Change password; returns a new token |
| POST | `/auth/password/forgot` | `{ email }` |
| POST | `/auth/password/reset` | `{ token, newPassword, confirmPassword }` |

**Profile and KYC**

| Method | Path | Notes |
|---|---|---|
| GET | `/users/me` | User, KYC status, wallet balance, unread count |
| PUT | `/users/me/pin` | `{ password, pin, confirmPin }` |
| GET | `/kyc/status` | |
| POST | `/kyc/submit` | `{ bvn, nin, bankCode, accountNumber }` |
| GET | `/banks` | Bank list for the picker |
| POST | `/banks/resolve` | `{ bankCode, accountNumber }` → account name |

**Market** (no sign-in needed)

| Method | Path | Notes |
|---|---|---|
| GET | `/assets` | Tradable crypto assets: `network` (the default) and `networks` (each with `sell`, `buy`, `confirmations`) |
| GET | `/rates?kind=CRYPTO\|GIFTCARD` | Desk rates with `updatedAt` |
| GET | `/giftcards/brands` | Brands and their `variants` (country, `cardType`, Naira rate per $1, limits, accepted values, `isDefault`) |

**Quotes** (a locked price)

| Method | Path | Notes |
|---|---|---|
| POST | `/quotes` | `{ kind: "CRYPTO" \| "GIFTCARD", side: "SELL" \| "BUY", symbol, amount, country?, cardType? }` → rate, `amountNgn`, `expiresAt`, `secondsLeft`. `country` and `cardType` apply to gift cards. |
| GET | `/quotes/:id` | Status: `OPEN`, `ACCEPTED` or `EXPIRED` |

To trade at the quoted price, create the order with `quoteId` before it expires. The order
takes its asset and amount from the quote and uses the locked rate even if the desk rate has
moved. A quote works once, only for the customer it was made for, and only for the kind of
trade it was made for; otherwise the order is refused with `409` (expired or used), `404`
(not yours) or `422` (wrong kind of trade). `amount` is a crypto quantity, or a gift card's
face value in USD. A quote is refused with `503` when the rate behind it has gone stale.

Orders can still be created without a quote; they are priced at the desk rate of the moment.

**Trading**

| Method | Path | Notes |
|---|---|---|
| GET | `/crypto/orders` | Mine, newest first (`?limit=`) |
| POST | `/crypto/orders` | `side: "SELL" \| "BUY"` plus the order fields, and optionally `network` (e.g. `"BEP20"`; default network if omitted). A buy's `userReceiveAddress` must fit that network. Idempotent. |
| GET | `/crypto/orders/:id` | |
| PATCH | `/crypto/orders/:id` | One of `{ txHash }`, `{ paymentRef }`, `{ status: "CANCELLED" }` |
| POST | `/crypto/orders/:id/checkout` | Card checkout for an unpaid buy order. Idempotent. |
| GET | `/giftcards/orders` | The card code is never returned |
| POST | `/giftcards/orders` | `{ brand, country?, cardType?, faceValueUsd, cardCode, payoutMethod }`. Priced by the brand + country + card type variant; missing values use the brand's default. Idempotent. |
| GET | `/giftcards/orders/:id` | |

**Wallet**

| Method | Path | Notes |
|---|---|---|
| GET | `/wallets` | Balance, limits, recent activity, funding options |
| GET | `/wallets/transactions` | Ledger, `?limit=&cursor=` → `{ items, nextCursor }` |
| GET | `/deposits` | Recent gateway payments |
| POST | `/deposits` | `{ amountNgn }` → checkout. Idempotent. Credits nothing until the provider confirms. |
| GET | `/deposits/:reference` | Payment status |
| GET | `/withdrawals` | |
| POST | `/withdrawals` | `{ amountNgn, pin }`. Idempotent. |
| DELETE | `/withdrawals/:id` | Cancel before the desk starts paying |

**Other**

| Method | Path | Notes |
|---|---|---|
| GET | `/referrals` | |
| GET / PATCH | `/notifications` | PATCH marks all read |
| GET / POST | `/alerts` | Rate alerts |
| DELETE | `/alerts/:id` | |
| POST | `/webhooks/:provider` | Provider callbacks (`paystack`). Signature verified. |

## Not in v1 yet

`/support/tickets` and `/admin/*` come with later milestones. The admin desk currently works through the web app, with every action checked
against the staff member's role (`src/lib/permissions.ts`).

## Adding a route

Keep the route file thin: wrap the handler in `authed()` or `open()` from `src/lib/api/v1.ts`,
call a service in `src/lib/services`, and map the result with `fromResult()`. Put no business
rules in the route. Add `{ idempotent: true }` to anything that creates money movement.
