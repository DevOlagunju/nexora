import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRequestUser, jsonError } from "@/lib/auth";
import { encryptSecret, orderReference } from "@/lib/crypto";
import { rateLimit, writeAudit } from "@/lib/security";
import { cryptoBuySchema, cryptoSellSchema, giftCardSellSchema, kycSchema } from "@/lib/validators";
import { verifyKycIdentity } from "@/lib/kyc-provider";
import { notifyAdmin } from "@/lib/notify";
import { platformBankDetails } from "@/lib/platform-bank";
import { supportWhatsAppDigits } from "@/lib/support";
import { assertDailyTradeAllowed, assessGiftCardRisk } from "@/lib/trade-limits";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Unauthorized", 401);

  const [kyc, cryptoOrders, giftOrders, rates, wallets] = await Promise.all([
    prisma.kycProfile.findUnique({ where: { userId: user.id } }),
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
        createdAt: true,
        completedAt: true,
      },
    }),
    prisma.rate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.platformWallet.findMany({ where: { isActive: true } }),
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
  });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? "");
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (action === "kyc") {
    const parsed = kycSchema.safeParse(body);
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid input");
    const { bvn, nin, bankName, accountNumber, accountName } = parsed.data;
    const check = await verifyKycIdentity({ bvn, nin, bankName, accountNumber, accountName });
    await prisma.kycProfile.upsert({
      where: { userId: user.id },
      update: {
        bvnLast4: bvn.slice(-4),
        ninLast4: nin.slice(-4),
        bankName,
        accountNumber,
        accountName,
        status: check.status,
        submittedAt: new Date(),
        reviewNote: check.mode === "provider" ? check.message : null,
        reviewedAt:
          check.status === "APPROVED" || check.status === "REJECTED" ? new Date() : null,
      },
      create: {
        userId: user.id,
        bvnLast4: bvn.slice(-4),
        ninLast4: nin.slice(-4),
        bankName,
        accountNumber,
        accountName,
        status: check.status,
        submittedAt: new Date(),
        reviewNote: check.mode === "provider" ? check.message : null,
        reviewedAt:
          check.status === "APPROVED" || check.status === "REJECTED" ? new Date() : null,
      },
    });
    await writeAudit("kyc.submit", { userId: user.id, ip, meta: { mode: check.mode } });
    void notifyAdmin("kyc.submitted", { userId: user.id, email: user.email, status: check.status });
    return NextResponse.json({ ok: true, message: check.message });
  }

  if (action === "sell-crypto") {
    if (!rateLimit(`m-crypto:${user.id}`, 15, 60_000)) {
      return jsonError("Too many orders. Slow down.", 429);
    }
    const kyc = await prisma.kycProfile.findUnique({ where: { userId: user.id } });
    if (!kyc || kyc.status !== "APPROVED") {
      return jsonError("Complete and get KYC approved before trading.");
    }
    const parsed = cryptoSellSchema.safeParse(body);
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid input");

    const rate = await prisma.rate.findUnique({
      where: { kind_symbol: { kind: "CRYPTO", symbol: parsed.data.symbol } },
    });
    if (!rate?.isActive) return jsonError("Asset unavailable.");
    if (parsed.data.amountCrypto < rate.minAmount) {
      return jsonError(`Minimum is ${rate.minAmount} ${rate.symbol}.`);
    }
    if (rate.maxAmount && parsed.data.amountCrypto > rate.maxAmount) {
      return jsonError(`Maximum is ${rate.maxAmount} ${rate.symbol}.`);
    }

    const sellRateNgn = rate.sellRateNgn;

    const wallet = await prisma.platformWallet.findUnique({
      where: { symbol: parsed.data.symbol },
    });
    if (!wallet?.isActive) return jsonError("Deposit wallet unavailable.");

    const amountNgn = parsed.data.amountCrypto * sellRateNgn;
    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
        const cap = await assertDailyTradeAllowed(
          { userId: user.id, kind: "crypto-sell", amountNgn },
          tx,
        );
        if (!cap.ok) throw new Error(cap.error);
        return tx.cryptoOrder.create({
          data: {
            reference: orderReference("NXC"),
            userId: user.id,
            symbol: parsed.data.symbol,
            network: wallet.network,
            side: "SELL",
            amountCrypto: parsed.data.amountCrypto,
            rateNgn: sellRateNgn,
            amountNgn,
            depositAddress: wallet.address,
            txHash: parsed.data.txHash,
            bankName: kyc.bankName,
            accountNumber: kyc.accountNumber,
            accountName: kyc.accountName,
            status: parsed.data.txHash ? "UNDER_REVIEW" : "AWAITING_DEPOSIT",
          },
        });
      });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : "Could not create order.");
    }
    await writeAudit("crypto.sell_create", {
      userId: user.id,
      ip,
      meta: { reference: order.reference },
    });
    void notifyAdmin("crypto.sell_created", { reference: order.reference, userId: user.id });
    return NextResponse.json({ ok: true, order });
  }

  if (action === "buy-crypto") {
    if (!rateLimit(`m-crypto-buy:${user.id}`, 15, 60_000)) {
      return jsonError("Too many orders. Slow down.", 429);
    }
    const kyc = await prisma.kycProfile.findUnique({ where: { userId: user.id } });
    if (!kyc || kyc.status !== "APPROVED") {
      return jsonError("Complete and get KYC approved before trading.");
    }
    const parsed = cryptoBuySchema.safeParse(body);
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid input");

    const rate = await prisma.rate.findUnique({
      where: { kind_symbol: { kind: "CRYPTO", symbol: parsed.data.symbol } },
    });
    if (!rate?.isActive) return jsonError("Asset unavailable.");
    if (parsed.data.amountCrypto < rate.minAmount) {
      return jsonError(`Minimum is ${rate.minAmount} ${rate.symbol}.`);
    }
    if (rate.maxAmount && parsed.data.amountCrypto > rate.maxAmount) {
      return jsonError(`Maximum is ${rate.maxAmount} ${rate.symbol}.`);
    }

    const buyRateNgn = rate.buyRateNgn;

    const wallet = await prisma.platformWallet.findUnique({
      where: { symbol: parsed.data.symbol },
    });
    if (!wallet?.isActive) return jsonError("Asset network unavailable.");

    const amountNgn = parsed.data.amountCrypto * buyRateNgn;
    const bank = platformBankDetails();
    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
        const cap = await assertDailyTradeAllowed(
          { userId: user.id, kind: "crypto-buy", amountNgn },
          tx,
        );
        if (!cap.ok) throw new Error(cap.error);
        return tx.cryptoOrder.create({
          data: {
            reference: orderReference("NXB"),
            userId: user.id,
            symbol: parsed.data.symbol,
            network: wallet.network,
            side: "BUY",
            amountCrypto: parsed.data.amountCrypto,
            rateNgn: buyRateNgn,
            amountNgn,
            userReceiveAddress: parsed.data.userReceiveAddress,
            paymentRef: parsed.data.paymentRef,
            bankName: bank.bankName,
            accountNumber: bank.accountNumber,
            accountName: bank.accountName,
            status: parsed.data.paymentRef ? "UNDER_REVIEW" : "AWAITING_DEPOSIT",
          },
        });
      });
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : "Could not create order.");
    }
    await writeAudit("crypto.buy_create", {
      userId: user.id,
      ip,
      meta: { reference: order.reference },
    });
    void notifyAdmin("crypto.buy_created", { reference: order.reference, userId: user.id });
    return NextResponse.json({ ok: true, order, platformBank: bank });
  }

  if (action === "sell-giftcard") {
    if (!rateLimit(`m-gift:${user.id}`, 10, 60_000)) {
      return jsonError("Too many orders. Slow down.", 429);
    }
    const kyc = await prisma.kycProfile.findUnique({ where: { userId: user.id } });
    if (!kyc || kyc.status !== "APPROVED") {
      return jsonError("Complete and get KYC approved before trading.");
    }
    const parsed = giftCardSellSchema.safeParse(body);
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid input");

    const rate = await prisma.rate.findUnique({
      where: { kind_symbol: { kind: "GIFTCARD", symbol: parsed.data.brand } },
    });
    if (!rate?.isActive) return jsonError("Gift card unavailable.");
    if (parsed.data.faceValueUsd < rate.minAmount) {
      return jsonError(`Minimum face value is $${rate.minAmount}.`);
    }
    if (rate.maxAmount && parsed.data.faceValueUsd > rate.maxAmount) {
      return jsonError(`Maximum face value is $${rate.maxAmount}.`);
    }

    const sealed = encryptSecret(parsed.data.cardCode);
    const amountNgn = parsed.data.faceValueUsd * rate.sellRateNgn;
    const risk = await assessGiftCardRisk({
      userId: user.id,
      faceValueUsd: parsed.data.faceValueUsd,
      brand: parsed.data.brand,
    });

    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
        const cap = await assertDailyTradeAllowed(
          { userId: user.id, kind: "gift-sell", amountNgn },
          tx,
        );
        if (!cap.ok) throw new Error(cap.error);
        return tx.giftCardOrder.create({
          data: {
            reference: orderReference("NXG"),
            userId: user.id,
            brand: parsed.data.brand,
            country: parsed.data.country,
            faceValueUsd: parsed.data.faceValueUsd,
            rateNgn: rate.sellRateNgn,
            amountNgn,
            cardCodeEncrypted: sealed.ciphertext,
            cardCodeIv: sealed.iv,
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
      return jsonError(err instanceof Error ? err.message : "Could not create order.");
    }
    await writeAudit("gift.sell_create", {
      userId: user.id,
      ip,
      meta: { reference: order.reference, fraudFlag: risk.fraudFlag },
    });
    void notifyAdmin("gift.sell_created", {
      reference: order.reference,
      userId: user.id,
      fraudFlag: risk.fraudFlag,
    });
    return NextResponse.json({
      ok: true,
      order: {
        id: order.id,
        reference: order.reference,
        brand: order.brand,
        amountNgn: order.amountNgn,
        status: order.status,
      },
    });
  }

  if (action === "crypto-tx") {
    const id = String(body?.id ?? "");
    const txHash = String(body?.txHash ?? "").trim();
    if (!id || txHash.length < 8) return jsonError("Provide a valid transaction hash.");
    const order = await prisma.cryptoOrder.findFirst({ where: { id, userId: user.id } });
    if (!order) return jsonError("Order not found.", 404);
    if (!["AWAITING_DEPOSIT", "UNDER_REVIEW"].includes(order.status)) {
      return jsonError("This order can no longer be updated.");
    }
    const updated = await prisma.cryptoOrder.update({
      where: { id },
      data: { txHash, status: "UNDER_REVIEW" },
    });
    void notifyAdmin("crypto.tx_submitted", { orderId: id, userId: user.id });
    return NextResponse.json({ ok: true, order: updated });
  }

  if (action === "buy-payment") {
    const id = String(body?.id ?? "");
    const paymentRef = String(body?.paymentRef ?? "").trim();
    if (!id || paymentRef.length < 4) return jsonError("Provide a valid bank payment reference.");
    const order = await prisma.cryptoOrder.findFirst({
      where: { id, userId: user.id, side: "BUY" },
    });
    if (!order) return jsonError("Order not found.", 404);
    if (!["AWAITING_DEPOSIT", "UNDER_REVIEW"].includes(order.status)) {
      return jsonError("This order can no longer be updated.");
    }
    const updated = await prisma.cryptoOrder.update({
      where: { id },
      data: { paymentRef, status: "UNDER_REVIEW" },
    });
    void notifyAdmin("crypto.payment_submitted", {
      orderId: id,
      reference: order.reference,
      userId: user.id,
    });
    return NextResponse.json({ ok: true, order: updated });
  }

  return jsonError("Unknown action.");
}
