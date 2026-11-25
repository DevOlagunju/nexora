import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRequestUser, jsonError } from "@/lib/auth";
import { ipFromHeaders } from "@/lib/security";
import { platformBankDetails } from "@/lib/platform-bank";
import { supportWhatsAppDigits } from "@/lib/support";
import { toResponse } from "@/lib/services/result";
import { lookupBankAccount, submitKyc } from "@/lib/services/kyc";
import { listBanks } from "@/lib/banks";
import {
  cancelUnfundedOrder,
  createCryptoBuyOrder,
  createCryptoSellOrder,
  createGiftCardSellOrder,
  submitBuyPaymentRef,
  submitCryptoTxHash,
} from "@/lib/services/trades";
import {
  cancelWithdrawal,
  getReferralOverview,
  getWalletOverview,
  requestWithdrawal,
  setTransactionPin,
} from "@/lib/services/wallet";
import {
  listNotifications,
  markNotificationsRead,
  unreadNotificationCount,
} from "@/lib/services/notifications";
import { createRateAlert, deleteRateAlert, listRateAlerts } from "@/lib/services/rate-alerts";
import { getDeskSpeed } from "@/lib/desk-stats";
import { paymentStatusFor, startBuyOrderCheckout, startWalletFunding } from "@/lib/services/payments";
import { activeGatewayName } from "@/lib/payments/gateway";
import { paymentConfig } from "@/lib/payment-rules";
import { publicOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

/**
 * Mobile app data + actions (bearer token auth).
 * GET  -> dashboard payload; ?view=wallet | notifications | referrals | alerts | banks for those screens,
 *         ?view=payment&reference=NXF-... for a gateway payment's status (nudges verification while pending)
 * POST -> { action: kyc | sell-crypto | buy-crypto | sell-giftcard | crypto-tx | buy-payment | cancel-order
 *                  | withdraw | cancel-withdrawal | set-pin | read-notifications | create-alert | delete-alert | resolve-account
 *                  | fund-wallet | pay-order, ... }
 * Gateway actions (fund-wallet, pay-order, buy-crypto with payFrom CARD) return a `checkout`
 * { reference, authorizationUrl }: open it in a browser, then poll ?view=payment.
 */

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Unauthorized", 401);

  const view = new URL(request.url).searchParams.get("view");
  if (view === "wallet") {
    const cfg = paymentConfig();
    return NextResponse.json({
      ...(await getWalletOverview(user.id)),
      funding: { provider: activeGatewayName(), minNgn: cfg.minFundingNgn, maxNgn: cfg.maxFundingNgn },
    });
  }
  if (view === "payment") {
    const reference = new URL(request.url).searchParams.get("reference") ?? "";
    return toResponse(await paymentStatusFor(user, reference.slice(0, 80)), (payment) => ({ ok: true, payment }));
  }
  if (view === "notifications") {
    return NextResponse.json({ items: await listNotifications(user.id, 50) });
  }
  if (view === "referrals") return NextResponse.json(await getReferralOverview(user.id));
  if (view === "alerts") return NextResponse.json({ items: await listRateAlerts(user.id) });
  if (view === "banks") return NextResponse.json(await listBanks());

  const [kyc, cryptoOrders, giftOrders, rates, wallets, me, unread, deskSpeed] = await Promise.all([
    prisma.kycProfile.findUnique({
      where: { userId: user.id },
      select: {
        status: true,
        bvnLast4: true,
        ninLast4: true,
        bankName: true,
        accountNumber: true,
        accountName: true,
        reviewNote: true,
        submittedAt: true,
        reviewedAt: true,
      },
    }),
    prisma.cryptoOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.giftCardOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        reference: true,
        brand: true,
        country: true,
        faceValueUsd: true,
        rateNgn: true,
        amountNgn: true,
        status: true,
        adminNote: true,
        createdAt: true,
        completedAt: true,
        payoutMethod: true,
        payoutRef: true,
      },
    }),
    prisma.rate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.platformWallet.findMany({
      where: { isActive: true },
      select: { symbol: true, network: true, address: true, note: true },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { walletBalanceNgn: true, transactionPinHash: true, referralCode: true },
    }),
    unreadNotificationCount(user.id),
    getDeskSpeed(7),
  ]);

  return NextResponse.json({
    user,
    kyc,
    cryptoOrders,
    giftOrders,
    rates,
    wallets,
    platformBank: platformBankDetails(),
    supportWhatsApp: supportWhatsAppDigits() || null,
    wallet: { balanceNgn: Math.max(0, me?.walletBalanceNgn ?? 0), hasPin: !!me?.transactionPinHash },
    referralCode: me?.referralCode ?? null,
    unreadNotifications: unread,
    deskSpeed,
    // "paystack" | "test" | null: whether card / instant-transfer checkout is available.
    instantPay: activeGatewayName(),
  });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonError("Invalid JSON body.");
  const ctx = { ip: ipFromHeaders(request.headers), origin: publicOrigin(request.headers) };
  // App builds released before the wallet existed don't send payoutMethod: keep paying them to the bank.
  if ((body.action === "sell-crypto" || body.action === "sell-giftcard") && body.payoutMethod === undefined) {
    body.payoutMethod = "BANK";
  }
  const done = (_d: unknown, message?: string) => ({ ok: true, message });

  switch (String(body.action ?? "")) {
    case "kyc":
      return toResponse(await submitKyc(user, body, ctx), (_d, message) => ({ ok: true, message }));

    case "sell-crypto":
      return toResponse(await createCryptoSellOrder(user, body, ctx), (order, message) => ({
        ok: true,
        order,
        message,
      }));

    case "buy-crypto": {
      const created = await createCryptoBuyOrder(user, body, ctx);
      const checkout =
        created.ok && body.payFrom === "CARD" ? await startBuyOrderCheckout(user, { orderId: created.data.order.id }, ctx) : null;
      return toResponse(created, (d, message) => ({
        ok: true,
        order: d.order,
        platformBank: d.platformBank,
        checkout: checkout?.ok ? checkout.data : undefined,
        checkoutError: checkout && !checkout.ok ? checkout.error : undefined,
        message,
      }));
    }

    case "fund-wallet":
      return toResponse(await startWalletFunding(user, body, ctx), (checkout, message) => ({ ok: true, checkout, message }));

    case "pay-order":
      return toResponse(await startBuyOrderCheckout(user, body, ctx), (checkout, message) => ({ ok: true, checkout, message }));

    case "sell-giftcard":
      return toResponse(await createGiftCardSellOrder(user, body, ctx), (order, message) => ({
        ok: true,
        order,
        message,
      }));

    case "crypto-tx":
      return toResponse(await submitCryptoTxHash(user, body, ctx), (order, message) => ({
        ok: true,
        order,
        message,
      }));

    case "buy-payment":
      return toResponse(await submitBuyPaymentRef(user, body, ctx), (order, message) => ({
        ok: true,
        order,
        message,
      }));

    case "cancel-order":
      return toResponse(await cancelUnfundedOrder(user, body, ctx), (order, message) => ({
        ok: true,
        order,
        message,
      }));

    case "withdraw":
      return toResponse(await requestWithdrawal(user, body, ctx), (d, message) => ({ ok: true, ...d, message }));

    case "cancel-withdrawal":
      return toResponse(await cancelWithdrawal(user, body), done);

    case "set-pin":
      return toResponse(await setTransactionPin(user, body, ctx), done);

    case "read-notifications":
      return NextResponse.json({ ok: true, marked: await markNotificationsRead(user.id) });

    case "resolve-account":
      return toResponse(await lookupBankAccount(user, body), (d) => ({ ok: true, ...d }));

    case "create-alert":
      return toResponse(await createRateAlert(user, body), done);

    case "delete-alert":
      return toResponse(await deleteRateAlert(user, body), done);

    default:
      return jsonError("Unknown action.");
  }
}
