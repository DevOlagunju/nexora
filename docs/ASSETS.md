# Assets and networks

Which crypto assets Nexora trades, and on which blockchain networks, is data managed on the
admin desk, not a list in the code. Prices stay on `Rate`; the registry decides where and how an
asset can move.

## Tables

| Table | What it holds |
|---|---|
| `BlockchainNetwork` | A network: its code (`TRC20`, `ERC20`, `BEP20`, `BTC`), name, address format, explorer link, default confirmations, on/off. |
| `AssetNetwork` | One asset on one network: deposit address (and memo), confirmations, whether customers can **sell** (send it in) and whether the desk can **buy** for them (send it out), and which network is the asset's default. |

## Rules

- An asset trades only if it has an active rate **and** at least one usable network in that
  direction. A rate with no network is not offered anywhere.
- An order may name a `network`. Without one it uses the asset's default network, or the only
  usable one. If several could be meant, the customer is asked to choose.
- A buy order's receive address must match the chosen network's address format. This catches
  wrong-network pastes (a `0x…` address for a TRC20 order). It is a format check, not a checksum.
- A sell order records the network and deposit address it was given, so later changes to the
  registry do not alter existing orders.
- Every asset has exactly one default network (enforced by the database).
- A network or asset switched off stops new orders at once. Existing orders are not touched.

## Admin desk

**Admin → Assets and networks** (permission: `wallets.manage`):

- Edit a deposit address, memo, confirmations, the customer note, Sell/Buy switches, and the
  default. A deposit address must fit the network's format.
- Add an asset on another network. It starts **switched off**: check custody, liquidity and the
  address, then enable Sell or Buy.
- Every change is audited with the old and new values. A deposit address change also alerts the
  admin webhook.

Adding a new **network** (a new address format) is done by migration, not on the desk, so that
address patterns are reviewed like code.

## Installed by the migration

| Network | Confirmations (starting policy) | Explorer |
|---|---|---|
| TRC20 (Tron) | 20 | tronscan.org |
| ERC20 (Ethereum) | 12 | etherscan.io |
| BEP20 (BNB Smart Chain) | 15 | bscscan.com |
| BTC (Bitcoin) | 2 | mempool.space |

Confirmation counts are a starting policy for operations to confirm. Nothing waits on them yet:
there is no blockchain monitoring, so the desk still verifies deposits by hand (the admin order
view links each transaction to its explorer).

The old `PlatformWallet` table was copied into the registry and is no longer used. It will be
dropped in a later migration.
