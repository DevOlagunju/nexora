import { createQuote } from "@/lib/services/quotes";
import { authed, fromResult } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/quotes  { kind: "CRYPTO" | "GIFTCARD", side: "SELL" | "BUY", symbol, amount }
 *   -> { id, rateNgn, amountNgn, expiresAt, secondsLeft, status, ... }
 *
 * Locks a price for a short time. Show `amountNgn` and the countdown, then create the order
 * with `quoteId` (POST /crypto/orders or /giftcards/orders) to trade at exactly this price.
 * `amount` is a crypto quantity, or a gift card's face value in USD.
 */
export const POST = authed(async ({ user, body, ctx }) => fromResult(await createQuote(user, body, ctx), (q) => q, 201));
