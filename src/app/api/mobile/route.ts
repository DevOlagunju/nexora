import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRequestUser, jsonError } from "@/lib/auth";
import { encryptSecret, orderReference } from "@/lib/crypto";
import { rateLimit, writeAudit } from "@/lib/security";
import { cryptoSellSchema, giftCardSellSchema, kycSchema } from "@/lib/validators";
import { deskQuotesFromMarket, fetchNgnMarket } from "@/lib/ngn-market";

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
    await prisma.kycProfile.upsert({
      where: { userId: user.id },
      update: {
        bvnLast4: bvn.slice(-4),
        ninLast4: nin.slice(-4),
        bankName,
        accountNumber,
        accountName,
        status: "PENDING",
        submittedAt: new Date(),
        reviewNote: null,
      },
      create: {
        userId: user.id,
        bvnLast4: bvn.slice(-4),
        ninLast4: nin.slice(-4),
        bankName,
        accountNumber,
        accountName,
        status: "PENDING",
        submittedAt: new Date(),
      },
    });
    await writeAudit("kyc.submit", { userId: user.id, ip });
    return NextResponse.json({ ok: true, message: "KYC submitted for review." });
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

    let sellRateNgn = rate.sellRateNgn;
    try {
      const market = await fetchNgnMarket();
      const desk = deskQuotesFromMarket(market);
      const live = desk[parsed.data.symbol as "USDT" | "BTC" | "ETH"];
      if (live) {
        sellRateNgn = live.sell;
        await prisma.rate.update({
          where: { id: rate.id },
          data: { sellRateNgn: live.sell, buyRateNgn: live.buy },
        });
      }
    } catch {
      /* keep DB rate */
    }

    const wallet = await prisma.platformWallet.findUnique({
      where: { symbol: parsed.data.symbol },
    });
    if (!wallet?.isActive) return jsonError("Deposit wallet unavailable.");

    const order = await prisma.cryptoOrder.create({
      data: {
        reference: orderReference("NXC"),
        userId: user.id,
        symbol: parsed.data.symbol,
        network: wallet.network,
        side: "SELL",
        amountCrypto: parsed.data.amountCrypto,
        rateNgn: sellRateNgn,
        amountNgn: parsed.data.amountCrypto * sellRateNgn,
        depositAddress: wallet.address,
        txHash: parsed.data.txHash,
        bankName: kyc.bankName,
        accountNumber: kyc.accountNumber,
        accountName: kyc.accountName,
        status: parsed.data.txHash ? "UNDER_REVIEW" : "AWAITING_DEPOSIT",
      },
    });
    await writeAudit("crypto.sell_create", {
      userId: user.id,
      ip,
      meta: { reference: order.reference },
    });
    return NextResponse.json({ ok: true, order });
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

    const sealed = encryptSecret(parsed.data.cardCode);
    const order = await prisma.giftCardOrder.create({
      data: {
        reference: orderReference("NXG"),
        userId: user.id,
        brand: parsed.data.brand,
        country: parsed.data.country,
        faceValueUsd: parsed.data.faceValueUsd,
        rateNgn: rate.sellRateNgn,
        amountNgn: parsed.data.faceValueUsd * rate.sellRateNgn,
        cardCodeEncrypted: sealed.ciphertext,
        cardCodeIv: sealed.iv,
        bankName: kyc.bankName,
        accountNumber: kyc.accountNumber,
        accountName: kyc.accountName,
        status: "UNDER_REVIEW",
      },
    });
    await writeAudit("gift.sell_create", {
      userId: user.id,
      ip,
      meta: { reference: order.reference },
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
    return NextResponse.json({ ok: true, order: updated });
  }

  return jsonError("Unknown action.");
}
