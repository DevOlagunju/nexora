import "server-only";
import { prisma, type CryptoOrder } from "@/lib/db";
import { encryptSecret, maskSecret, orderReference } from "@/lib/crypto";
import { rateLimit, writeAudit } from "@/lib/security";
import { cryptoBuySchema, cryptoSellSchema, giftCardSellSchema } from "@/lib/validators";
import { notifyAdmin } from "@/lib/notify";
import { platformBankDetails } from "@/lib/platform-bank";
import { assertDailyTradeAllowed, assessGiftCardRisk } from "@/lib/trade-limits";
import { mulNgn } from "@/lib/money";
import { CUSTOMER_EDITABLE } from "@/lib/order-status";
import type { AssetKind } from "@/generated/prisma/enums";
import { fail, ok, TOO_MANY, type ServiceResult } from "@/lib/services/result";
import { debitWallet } from "@/lib/services/wallet";
import { claimQuote, quoteForOrder, QuoteGoneError } from "@/lib/services/quotes";
import { resolveAssetNetwork } from "@/lib/services/assets";
import { addressProblem } from "@/lib/asset-rules";
import { resolveGiftVariant } from "@/lib/services/giftcards";
import { customerDepositAddress } from "@/lib/services/deposits";
import { faceValueProblem } from "@/lib/giftcard-rules";
import { errorMessage, log } from "@/lib/log";

/**
 * Customer trade flows shared by web server actions and the mobile JSON API.
 * Rate-limit keys are shared too, so switching clients does not double the budget.
 */

type Actor = { id: string; email: string };
type Ctx = { ip: string };

const LIMIT_PER_MIN = { crypto: 15, gift: 10, update: 20 } as const;

class DailyCapError extends Error {}

export const isWalletPaymentRef = (ref: string | null | undefined) => !!ref && ref.trim().toLowerCase().startsWith("wallet:");
class InsufficientWalletError extends Error {}

async function requireApprovedKyc(userId: string) {
  const kyc = await prisma.kycProfile.findUnique({ where: { userId } });
  if (!kyc || kyc.status !== "APPROVED") return null;
  return kyc;
}

async function loadTradableRate(kind: AssetKind, symbol: string, amount: number, unit: "coin" | "usd") {
  const rate = await prisma.rate.findUnique({ where: { kind_symbol: { kind, symbol } } });
  if (!rate || !rate.isActive) {
    return fail(kind === "CRYPTO" ? "This asset is not available right now." : "This gift card is not available right now.");
  }
  const fmt = (n: number) => (unit === "usd" ? `$${n}` : `${n} ${rate.symbol}`);
  const label = unit === "usd" ? "face value" : "";
  if (amount < rate.minAmount) return fail(`Minimum ${label ? `${label} ` : ""}is ${fmt(rate.minAmount)}.`);
  if (rate.maxAmount && amount > rate.maxAmount) {
    return fail(`Maximum ${label ? `${label} ` : ""}is ${fmt(rate.maxAmount)}.`);
  }
  return ok(rate);
}

function capErrorOr(err: unknown): ServiceResult<never> {
  if (err instanceof DailyCapError) return fail(err.message, 422);
  if (err instanceof InsufficientWalletError) return fail(err.message, 422);
  if (err instanceof QuoteGoneError) return fail(err.message, 409);
  throw err;
}

export async function createCryptoSellOrder(
  user: Actor,
  input: unknown,
  ctx: Ctx,
): Promise<ServiceResult<CryptoOrder>> {
  if (!(await rateLimit(`order:crypto:${user.id}`, LIMIT_PER_MIN.crypto))) return TOO_MANY("orders");

  const kyc = await requireApprovedKyc(user.id);
  if (!kyc) return fail("Complete and get KYC approved before trading.", 403);

  const quoted = await quoteForOrder(user.id, input, { kind: "CRYPTO", side: "SELL" });
  if (!quoted.ok) return quoted;
  const quote = quoted.data;

  // With a quote, the asset and amount are the quote's: the customer accepts it as it stands.
  const parsed = cryptoSellSchema.safeParse(quote ? { ...(input as object), symbol: quote.symbol, amountCrypto: quote.amount } : input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { symbol, network: requestedNetwork, amountCrypto, txHash, payoutMethod } = parsed.data;

  const rateRes = await loadTradableRate("CRYPTO", symbol, amountCrypto, "coin");
  if (!rateRes.ok) return rateRes;
  const rate = rateRes.data;

  // Which network, and where the customer sends the asset, come from the registry.
  const placed = await resolveAssetNetwork(symbol, "SELL", requestedNetwork);
  if (!placed.ok) return placed;
  const wallet = placed.data;
  // With a deposit provider, the customer sends to their own address and the deposit is matched
  // automatically. Without one, to the desk's shared address as before.
  let own: Awaited<ReturnType<typeof customerDepositAddress>>;
  try {
    own = await customerDepositAddress(user.id, symbol, wallet.network);
  } catch (err) {
    // Never fall back to an address nobody is watching for this customer.
    log.error("trades: deposit provider failed", { symbol, network: wallet.network.code, error: errorMessage(err) });
    return fail("We couldn't create your deposit address just now. Please try again in a few minutes.", 503);
  }
  const depositAddress = own?.address ?? wallet.depositAddress;
  const depositMemo = own ? own.memo : wallet.depositMemo;

  // A quote's locked price wins; otherwise the desk rate at this moment is authoritative.
  const rateNgn = quote?.rateNgn ?? rate.sellRateNgn;
  const amountNgn = quote?.amountNgn ?? mulNgn(amountCrypto, rate.sellRateNgn);
  let order: CryptoOrder;
  try {
    order = await prisma.$transaction(async (tx) => {
      const cap = await assertDailyTradeAllowed({ userId: user.id, kind: "crypto-sell", amountNgn }, tx);
      if (!cap.ok) throw new DailyCapError(cap.error);
      const reference = orderReference("NXC");
      if (quote) await claimQuote(tx, quote.id, user.id, reference);
      return tx.cryptoOrder.create({
        data: {
          reference,
          userId: user.id,
          symbol,
          network: wallet.network.code,
          side: "SELL",
          amountCrypto,
          rateNgn,
          // The market price behind the rate, for the earnings report. The quote's if there is one.
          marketRateNgn: quote ? quote.marketRateNgn : rate.marketRateNgn,
          amountNgn,
          depositAddress,
          txHash: txHash || undefined,
          payoutMethod,
          bankName: kyc.bankName,
          accountNumber: kyc.accountNumber,
          accountName: kyc.accountName,
          status: txHash ? "UNDER_REVIEW" : "AWAITING_DEPOSIT",
        },
      });
    });
  } catch (err) {
    return capErrorOr(err);
  }

  await writeAudit("crypto.sell_create", {
    userId: user.id,
    ip: ctx.ip,
    meta: { reference: order.reference, symbol: order.symbol },
  });
  void notifyAdmin("crypto.sell_created", {
    reference: order.reference,
    symbol: order.symbol,
    amountCrypto: order.amountCrypto,
    amountNgn: order.amountNgn,
    userId: user.id,
  });

  return ok(
    order,
    `Order ${order.reference} created. Send ${amountCrypto} ${order.symbol} on ${order.network} only to ${order.depositAddress}${
      depositMemo ? ` with memo ${depositMemo}` : ""
    }${own ? ". We'll see it arrive and confirm it automatically." : ", then submit your TX hash from Orders."}`,
  );
}

export async function createCryptoBuyOrder(
  user: Actor,
  input: unknown,
  ctx: Ctx,
): Promise<ServiceResult<{ order: CryptoOrder; platformBank: ReturnType<typeof platformBankDetails> }>> {
  if (!(await rateLimit(`order:crypto:${user.id}`, LIMIT_PER_MIN.crypto))) return TOO_MANY("orders");

  const kyc = await requireApprovedKyc(user.id);
  if (!kyc) return fail("Complete and get KYC approved before trading.", 403);

  const quoted = await quoteForOrder(user.id, input, { kind: "CRYPTO", side: "BUY" });
  if (!quoted.ok) return quoted;
  const quote = quoted.data;

  const parsed = cryptoBuySchema.safeParse(quote ? { ...(input as object), symbol: quote.symbol, amountCrypto: quote.amount } : input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { symbol, network: requestedNetwork, amountCrypto, userReceiveAddress, paymentRef, payFrom } = parsed.data;

  const rateRes = await loadTradableRate("CRYPTO", symbol, amountCrypto, "coin");
  if (!rateRes.ok) return rateRes;
  const rate = rateRes.data;

  // The desk sends the asset out on this network, so the customer's address must belong to it.
  const placed = await resolveAssetNetwork(symbol, "BUY", requestedNetwork);
  if (!placed.ok) return placed;
  const wallet = placed.data;
  const addressIssue = addressProblem(userReceiveAddress, wallet.network);
  if (addressIssue) return fail(addressIssue, 422);

  const rateNgn = quote?.rateNgn ?? rate.buyRateNgn;
  const amountNgn = quote?.amountNgn ?? mulNgn(amountCrypto, rate.buyRateNgn);
  const bank = platformBankDetails();
  let order: CryptoOrder;
  try {
    order = await prisma.$transaction(async (tx) => {
      const cap = await assertDailyTradeAllowed({ userId: user.id, kind: "crypto-buy", amountNgn }, tx);
      if (!cap.ok) throw new DailyCapError(cap.error);
      const reference = orderReference("NXB");
      if (quote) await claimQuote(tx, quote.id, user.id, reference);
      if (payFrom === "WALLET") {
        const paid = await debitWallet(tx, {
          userId: user.id,
          amountNgn,
          reference: `buy:${reference}`,
          kind: "purchase",
          source: `customer:${user.id}`,
          description: `Bought ${amountCrypto} ${symbol} (${reference})`,
        });
        if (!paid) throw new InsufficientWalletError("Your wallet balance doesn't cover this order. Pay by bank transfer instead.");
      }
      const funded = payFrom === "WALLET" ? `wallet:${reference}` : paymentRef || undefined;
      return tx.cryptoOrder.create({
        data: {
          reference,
          userId: user.id,
          symbol,
          network: wallet.network.code,
          side: "BUY",
          amountCrypto,
          rateNgn,
          marketRateNgn: quote ? quote.marketRateNgn : rate.marketRateNgn,
          amountNgn,
          userReceiveAddress,
          paymentRef: funded,
          bankName: bank.bankName,
          accountNumber: bank.accountNumber,
          accountName: bank.accountName,
          status: funded ? "UNDER_REVIEW" : "AWAITING_DEPOSIT",
        },
      });
    });
  } catch (err) {
    return capErrorOr(err);
  }

  await writeAudit("crypto.buy_create", {
    userId: user.id,
    ip: ctx.ip,
    meta: { reference: order.reference, symbol: order.symbol },
  });
  void notifyAdmin("crypto.buy_created", {
    reference: order.reference,
    symbol: order.symbol,
    amountCrypto: order.amountCrypto,
    amountNgn: order.amountNgn,
    userId: user.id,
  });

  const naira = amountNgn.toLocaleString("en-NG", { style: "currency", currency: "NGN" });
  return ok(
    { order, platformBank: bank },
    payFrom === "WALLET"
      ? `Order ${order.reference} paid from your wallet (${naira}). The desk will send ${amountCrypto} ${symbol} to ${userReceiveAddress}.`
      : payFrom === "CARD"
        ? `Order ${order.reference} created. Complete your ${naira} payment on the secure checkout; it's confirmed instantly.`
        : `Order ${order.reference} created. Pay ${naira} to ${bank.accountName} Â· ${bank.bankName} Â· ${bank.accountNumber}, then submit your payment reference from Orders. Crypto goes to ${userReceiveAddress}.`,
  );
}

export type GiftOrderSummary = {
  id: string;
  reference: string;
  brand: string;
  amountNgn: number;
  status: string;
  fraudFlag: boolean;
};

export async function createGiftCardSellOrder(
  user: Actor,
  input: unknown,
  ctx: Ctx,
): Promise<ServiceResult<GiftOrderSummary>> {
  if (!(await rateLimit(`order:gift:${user.id}`, LIMIT_PER_MIN.gift))) return TOO_MANY("orders");

  const kyc = await requireApprovedKyc(user.id);
  if (!kyc) return fail("Complete and get KYC approved before trading.", 403);

  const quoted = await quoteForOrder(user.id, input, { kind: "GIFTCARD", side: "SELL" });
  if (!quoted.ok) return quoted;
  const quote = quoted.data;

  // With a quote, the card (brand, country, type, face value) is the one that was quoted.
  const parsed = giftCardSellSchema.safeParse(
    quote
      ? { ...(input as object), brand: quote.symbol, faceValueUsd: quote.amount, country: quote.country ?? undefined, cardType: quote.cardType ?? undefined }
      : input,
  );
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { brand, faceValueUsd, cardCode, payoutMethod } = parsed.data;

  // The variant (brand + country + card type) sets the price and the accepted face values.
  const variantRes = await resolveGiftVariant(brand, { country: parsed.data.country, cardType: parsed.data.cardType });
  if (!variantRes.ok) return variantRes;
  const variant = variantRes.data;
  if (!quote) {
    const faceIssue = faceValueProblem(variant, faceValueUsd);
    if (faceIssue) return fail(faceIssue, 422);
  }
  const { country, cardType } = variant;

  const sealed = encryptSecret(cardCode);
  const rateNgn = quote?.rateNgn ?? variant.rateNgn;
  const amountNgn = quote?.amountNgn ?? mulNgn(faceValueUsd, variant.rateNgn);
  const risk = await assessGiftCardRisk({ userId: user.id, faceValueUsd, brand });

  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      const cap = await assertDailyTradeAllowed({ userId: user.id, kind: "gift-sell", amountNgn }, tx);
      if (!cap.ok) throw new DailyCapError(cap.error);
      const reference = orderReference("NXG");
      if (quote) await claimQuote(tx, quote.id, user.id, reference);
      return tx.giftCardOrder.create({
        data: {
          reference,
          userId: user.id,
          brand,
          country,
          cardType,
          faceValueUsd,
          rateNgn,
          amountNgn,
          cardCodeEncrypted: sealed.ciphertext,
          cardCodeIv: sealed.iv,
          payoutMethod,
          bankName: kyc.bankName,
          accountNumber: kyc.accountNumber,
          accountName: kyc.accountName,
          status: "UNDER_REVIEW",
          fraudFlag: risk.fraudFlag,
          fraudNote: risk.fraudNote,
        },
      });
    });
  } catch (err) {
    return capErrorOr(err);
  }

  await writeAudit("gift.sell_create", {
    userId: user.id,
    ip: ctx.ip,
    meta: { reference: order.reference, brand: order.brand, fraudFlag: risk.fraudFlag, fraudNote: risk.fraudNote },
  });
  void notifyAdmin("gift.sell_created", {
    reference: order.reference,
    brand: order.brand,
    amountNgn: order.amountNgn,
    userId: user.id,
    fraudFlag: risk.fraudFlag,
    fraudNote: risk.fraudNote,
  });

  return ok(
    {
      id: order.id,
      reference: order.reference,
      brand: order.brand,
      amountNgn: order.amountNgn,
      status: order.status,
      fraudFlag: order.fraudFlag,
    },
    risk.fraudFlag
      ? `Gift card order ${order.reference} is under enhanced review.`
      : `Gift card order ${order.reference} is under review. Code stored encrypted.`,
  );
}

export async function submitCryptoTxHash(
  user: Actor,
  input: { id?: unknown; txHash?: unknown },
  ctx: Ctx,
): Promise<ServiceResult<CryptoOrder>> {
  if (!(await rateLimit(`order:update:${user.id}`, LIMIT_PER_MIN.update))) return TOO_MANY();
  const id = String(input.id ?? "").trim();
  const txHash = String(input.txHash ?? "").trim();
  if (!id || txHash.length < 8 || txHash.length > 120) return fail("Provide a valid transaction hash.");

  const order = await prisma.cryptoOrder.findFirst({ where: { id, userId: user.id, side: "SELL" } });
  if (!order) return fail("Order not found.", 404);
  if (!CUSTOMER_EDITABLE.includes(order.status)) return fail("This order can no longer be updated.", 409);

  const updated = await prisma.cryptoOrder.update({ where: { id }, data: { txHash, status: "UNDER_REVIEW" } });
  await writeAudit("crypto.tx_submit", { userId: user.id, ip: ctx.ip, meta: { id, txHash: maskSecret(txHash, 6) } });
  void notifyAdmin("crypto.tx_submitted", { orderId: id, reference: order.reference, userId: user.id });
  return ok(updated, "Transaction hash submitted. Our desk will verify and pay out.");
}

export async function submitBuyPaymentRef(
  user: Actor,
  input: { id?: unknown; paymentRef?: unknown },
  ctx: Ctx,
): Promise<ServiceResult<CryptoOrder>> {
  if (!(await rateLimit(`order:update:${user.id}`, LIMIT_PER_MIN.update))) return TOO_MANY();
  const id = String(input.id ?? "").trim();
  const paymentRef = String(input.paymentRef ?? "").trim();
  if (!id || paymentRef.length < 4 || paymentRef.length > 120) return fail("Provide a valid bank payment reference.");
  // "wallet:" marks money already held by Nexora (wallet/card paid) and drives refunds; customers can't type it.
  if (isWalletPaymentRef(paymentRef)) return fail("Provide a valid bank payment reference.");

  const order = await prisma.cryptoOrder.findFirst({ where: { id, userId: user.id, side: "BUY" } });
  if (!order) return fail("Order not found.", 404);
  if (!CUSTOMER_EDITABLE.includes(order.status)) return fail("This order can no longer be updated.", 409);
  if (isWalletPaymentRef(order.paymentRef)) return fail("This order is already paid.", 409);

  const { count } = await prisma.cryptoOrder.updateMany({
    where: { id, status: order.status, paymentRef: order.paymentRef },
    data: { paymentRef, status: "UNDER_REVIEW" },
  });
  if (count === 0) return fail("This order just changed. Refresh and try again.", 409);
  const updated = await prisma.cryptoOrder.findUniqueOrThrow({ where: { id } });
  await writeAudit("crypto.payment_submit", {
    userId: user.id,
    ip: ctx.ip,
    meta: { id, paymentRef: maskSecret(paymentRef, 4) },
  });
  void notifyAdmin("crypto.payment_submitted", { orderId: id, reference: order.reference, userId: user.id });
  return ok(updated, "Payment reference submitted. Desk will verify and send crypto.");
}

/** Customer cancels an order they have not funded yet. */
export async function cancelUnfundedOrder(
  user: Actor,
  input: { id?: unknown },
  ctx: Ctx,
): Promise<ServiceResult<CryptoOrder>> {
  if (!(await rateLimit(`order:update:${user.id}`, LIMIT_PER_MIN.update))) return TOO_MANY();
  const id = String(input.id ?? "").trim();
  if (!id) return fail("Missing order id.");

  // Conditional update so a concurrent desk change cannot be overwritten.
  const { count } = await prisma.cryptoOrder.updateMany({
    where: { id, userId: user.id, status: "AWAITING_DEPOSIT" },
    data: { status: "CANCELLED", adminNote: "Cancelled by customer" },
  });
  if (count === 0) return fail("Only orders still awaiting deposit can be cancelled.", 409);

  const order = await prisma.cryptoOrder.findUniqueOrThrow({ where: { id } });
  await writeAudit("crypto.cancel", { userId: user.id, ip: ctx.ip, meta: { id, reference: order.reference } });
  void notifyAdmin("crypto.cancelled_by_user", { orderId: id, reference: order.reference, userId: user.id });
  return ok(order, `Order ${order.reference} cancelled.`);
}
