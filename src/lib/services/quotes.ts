import "server-only";
import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { orderReference } from "@/lib/crypto";
import { rateLimit, writeAudit } from "@/lib/security";
import { mulNgn } from "@/lib/money";
import { quoteConfig, quoteExpiry, quoteStatus, rateIsStale, secondsLeft, type QuoteStatus } from "@/lib/quote-rules";
import { fail, ok, TOO_MANY, type ServiceResult } from "@/lib/services/result";
import { assetTradable } from "@/lib/services/assets";
import { resolveGiftVariant } from "@/lib/services/giftcards";
import { faceValueProblem } from "@/lib/giftcard-rules";

/**
 * Quotes: a locked price with an expiry.
 *
 *   1. The customer asks what an amount is worth (createQuote). The server prices it from the
 *      desk rate, records where that rate came from and when it was set, and promises the
 *      result until `expiresAt`.
 *   2. The customer accepts by creating an order with `quoteId`. The order uses the locked
 *      rate and amount, and the quote is marked used in the same database transaction.
 *
 * A quote can be used once, only by the customer it was made for, and only before it expires.
 * All pricing is done here on the server; a client never sends a rate or a Naira amount.
 */

type Actor = { id: string };
type Ctx = { ip: string };

const quoteSchema = z.object({
  kind: z.enum(["CRYPTO", "GIFTCARD"]),
  side: z.enum(["SELL", "BUY"]),
  symbol: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .transform((s) => s.toUpperCase()),
  amount: z.coerce.number().positive().finite(),
  /** Gift cards only: the country the card is from and its type. Missing: the brand's default. */
  country: z.string().trim().max(40).optional(),
  cardType: z.string().trim().max(20).optional(),
});

export type QuoteView = {
  id: string;
  reference: string;
  kind: "CRYPTO" | "GIFTCARD";
  side: "SELL" | "BUY";
  symbol: string;
  amount: number;
  rateNgn: number;
  feeNgn: number;
  /** What the customer receives (sell) or pays (buy). */
  amountNgn: number;
  rateSource: string;
  rateUpdatedAt: Date;
  expiresAt: Date;
  secondsLeft: number;
  status: QuoteStatus;
  orderReference: string | null;
  /** Gift cards: the variant that was priced. Null for crypto. */
  country: string | null;
  cardType: "ECODE" | "PHYSICAL" | null;
};

type QuoteRow = NonNullable<Awaited<ReturnType<typeof prisma.quote.findFirst>>>;

function view(q: QuoteRow, now = new Date()): QuoteView {
  return {
    id: q.id,
    reference: q.reference,
    kind: q.kind,
    side: q.side,
    symbol: q.symbol,
    amount: q.amount,
    rateNgn: q.rateNgn,
    feeNgn: q.feeNgn,
    amountNgn: q.amountNgn,
    rateSource: q.rateSource,
    rateUpdatedAt: q.rateUpdatedAt,
    expiresAt: q.expiresAt,
    secondsLeft: q.acceptedAt ? 0 : secondsLeft(q, now),
    status: quoteStatus(q, now),
    orderReference: q.orderReference,
    country: q.country,
    cardType: q.cardType,
  };
}

type Priced = {
  rateNgn: number;
  rateUpdatedAt: Date;
  /** Crypto: the market mid the desk rate came from, when known. */
  marketRateNgn?: number | null;
  country?: string;
  cardType?: "ECODE" | "PHYSICAL";
};

/** The rate a quote is taken from, after every check that the trade is possible. */
async function priceFor(
  kind: "CRYPTO" | "GIFTCARD",
  side: "SELL" | "BUY",
  symbol: string,
  amount: number,
  variant: { country?: string; cardType?: string },
): Promise<ServiceResult<Priced>> {
  if (kind === "GIFTCARD") {
    if (side !== "SELL") return fail("Gift cards can only be sold.");
    const v = await resolveGiftVariant(symbol, variant);
    if (!v.ok) return v;
    const faceIssue = faceValueProblem(v.data, amount);
    if (faceIssue) return fail(faceIssue, 422);
    return ok({ rateNgn: v.data.rateNgn, rateUpdatedAt: v.data.updatedAt, country: v.data.country, cardType: v.data.cardType });
  }

  const rate = await prisma.rate.findUnique({ where: { kind_symbol: { kind, symbol } } });
  if (!rate || !rate.isActive) return fail("This asset is not available right now.");
  // Never promise a price for crypto that cannot move on any network in this direction.
  if (!(await assetTradable(symbol, side))) return fail("This asset is not available right now.");
  if (amount < rate.minAmount) return fail(`Minimum is ${rate.minAmount} ${rate.symbol}.`);
  if (rate.maxAmount && amount > rate.maxAmount) return fail(`Maximum is ${rate.maxAmount} ${rate.symbol}.`);
  return ok({ rateNgn: side === "SELL" ? rate.sellRateNgn : rate.buyRateNgn, rateUpdatedAt: rate.updatedAt, marketRateNgn: rate.marketRateNgn });
}

export async function createQuote(user: Actor, input: unknown, ctx: Ctx): Promise<ServiceResult<QuoteView>> {
  if (!(await rateLimit(`quote:${user.id}`, 30))) return TOO_MANY("quotes");

  const parsed = quoteSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { kind, side, symbol, amount } = parsed.data;

  const priced = await priceFor(kind, side, symbol, amount, { country: parsed.data.country, cardType: parsed.data.cardType });
  if (!priced.ok) return priced;
  const { rateNgn, rateUpdatedAt, country, cardType, marketRateNgn } = priced.data;

  const cfg = quoteConfig();
  const now = new Date();
  if (rateIsStale(kind, rateUpdatedAt, cfg, now)) {
    // Never promise a price from a rate nobody has refreshed.
    return fail("Rates are being updated. Please try again in a moment.", 503);
  }
  if (!(rateNgn > 0)) return fail("This asset is not available right now.");
  const amountNgn = mulNgn(amount, rateNgn);
  if (!(amountNgn > 0)) return fail("That amount is too small to trade.");

  const quote = await prisma.quote.create({
    data: {
      reference: orderReference("NXQ"),
      userId: user.id,
      kind,
      side,
      symbol,
      amount,
      rateNgn,
      amountNgn,
      rateSource: "desk",
      rateUpdatedAt,
      expiresAt: quoteExpiry(cfg, now),
      country,
      cardType,
      marketRateNgn: marketRateNgn ?? null,
    },
  });
  await writeAudit("quote.create", {
    userId: user.id,
    ip: ctx.ip,
    meta: { reference: quote.reference, kind, side, symbol, amount, rateNgn, amountNgn, country, cardType, expiresAt: quote.expiresAt },
  });
  return ok(view(quote, now));
}

export async function getQuote(user: Actor, id: string): Promise<ServiceResult<QuoteView>> {
  const quote = await prisma.quote.findFirst({ where: { id, userId: user.id } });
  return quote ? ok(view(quote)) : fail("Quote not found.", 404);
}

export type LockedQuote = {
  id: string;
  symbol: string;
  amount: number;
  rateNgn: number;
  amountNgn: number;
  country: string | null;
  cardType: "ECODE" | "PHYSICAL" | null;
  marketRateNgn: number | null;
};

const GONE = "This quote has expired or was already used. Get a new quote.";

/**
 * The quote an order is being created from, or null when the request names none.
 * Checks ownership, kind, side and expiry up front so the customer gets a clear message;
 * claimQuote() makes the final, race-free check inside the order's transaction.
 */
export async function quoteForOrder(
  userId: string,
  input: unknown,
  expected: { kind: "CRYPTO" | "GIFTCARD"; side: "SELL" | "BUY" },
): Promise<ServiceResult<LockedQuote | null>> {
  const quoteId = (input as { quoteId?: unknown } | null)?.quoteId;
  if (quoteId === undefined || quoteId === null || quoteId === "") return ok(null);
  if (typeof quoteId !== "string") return fail("Invalid quote.");

  const quote = await prisma.quote.findFirst({ where: { id: quoteId, userId } });
  if (!quote) return fail("Quote not found.", 404);
  if (quote.kind !== expected.kind || quote.side !== expected.side) {
    return fail("This quote is for a different kind of trade.", 422);
  }
  if (quoteStatus(quote) !== "OPEN") return fail(GONE, 409);
  return ok({
    id: quote.id,
    symbol: quote.symbol,
    amount: quote.amount,
    rateNgn: quote.rateNgn,
    amountNgn: quote.amountNgn,
    country: quote.country,
    cardType: quote.cardType,
    marketRateNgn: quote.marketRateNgn,
  });
}

/** Thrown inside an order's transaction when the quote can no longer be used; rolls the order back. */
export class QuoteGoneError extends Error {
  constructor() {
    super(GONE);
  }
}

/**
 * Marks a quote as used by `orderRef`, inside the order's database transaction.
 * One conditional update: of any number of simultaneous attempts, exactly one succeeds,
 * and none succeeds after the expiry.
 */
export async function claimQuote(tx: Db, quoteId: string, userId: string, orderRef: string, now = new Date()): Promise<void> {
  const { count } = await tx.quote.updateMany({
    where: { id: quoteId, userId, acceptedAt: null, expiresAt: { gt: now } },
    data: { acceptedAt: now, orderReference: orderRef },
  });
  if (count === 0) throw new QuoteGoneError();
}

/**
 * Cron leg: forget quotes that expired unused more than a week ago.
 * Accepted quotes are kept: they explain the price of the order made from them.
 */
export async function purgeUnusedQuotes(now = new Date()) {
  const { count } = await prisma.quote.deleteMany({
    where: { acceptedAt: null, expiresAt: { lt: new Date(now.getTime() - 7 * 24 * 3_600_000) } },
  });
  return count;
}
