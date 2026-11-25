# Gift card rates

A gift card is priced by its **variant**: brand + the country it was issued in + card type
(e-code or physical card). Each variant has its own Naira rate per US dollar of face value,
minimum and maximum face value, and optionally a fixed list of accepted face values.

| Table | What it holds |
|---|---|
| `Rate` (kind `GIFTCARD`) | The brand: name, on/off, and a headline rate. |
| `GiftCardRate` | One variant: country (ISO code), card type, rate, limits, accepted values, on/off, default. |

## Rules

- A card can be sold only if its brand is on **and** its variant is on.
- An order or quote may name `country` (a code like `GB` or a name like `UK`) and `cardType`
  (`ECODE` or `PHYSICAL`). Missing values come from the brand's **default** variant; for a named
  country, the default's card type is used if offered, else the only type that is.
- If the card's country is not bought, the customer is told which countries are.
- With a fixed list of accepted values, only those face values are taken.
- Each brand has exactly one default (enforced by the database), and it must be on.
- The brand's headline rate on `Rate` is kept equal to its default variant, in the same database
  transaction. The rates page, the home page, rate alerts and the current mobile app show this rate.
- Face values are in **US dollars** for every country, as the mobile app already asks.
- Orders record the country (ISO code) and card type they were priced as. Orders from before this
  change have no card type; their country names were converted to codes (USA→US, UK→GB,
  GERMANY→DE, CANADA→CA).

## Admin desk

**Admin → Gift card rates** (permission: `rates.manage`): edit each variant's rate, limits,
accepted values, on/off and default; add a country or card type for a brand (it starts switched
off, unless it is the brand's first). Every change is written to the audit log with the old and
new values: that is the rate history.

In the main **Rates** list a gift card brand can only be switched on or off; its price is set per
variant.

## Starting state

The migration gave every brand a variant for each country the mobile app offers (US, UK,
Germany, Canada) and each card type, **all at the brand's previous single rate**, so no price
changed. US e-code is each brand's default. Set real prices per variant on the desk.

## Known limits

- **Face values are always USD.** A card issued in pounds or euros is priced on its USD value,
  which the customer enters. Pricing in the card's own currency needs a foreign-exchange source.
- **The current mobile app estimates the payout itself** from the brand's headline rate. For any
  variant other than the default the estimate can differ from the final price; the order
  response carries the real amount. Moving the app to `/api/v1` quotes fixes this.
- **The fraud flag for high face values** compares the USD face value with one threshold for all
  countries and card types.
