"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, destroySession, getSessionUser, requireAdmin, requireUser } from "@/lib/auth";
import { encryptSecret, orderReference, maskSecret } from "@/lib/crypto";
import { rateLimit, writeAudit } from "@/lib/security";
import { deskQuotesFromMarket, fetchNgnMarket } from "@/lib/ngn-market";
import {
  registerSchema,
  loginSchema,
  kycSchema,
  cryptoSellSchema,
  cryptoBuySchema,
  giftCardSellSchema,
  rateUpdateSchema,
  orderStatusSchema,
} from "@/lib/validators";
import { notifyAdmin } from "@/lib/notify";
import { verifyKycIdentity } from "@/lib/kyc-provider";
import { paystackConfigured, payoutSellOrder } from "@/lib/paystack";
import { platformBankDetails } from "@/lib/platform-bank";
import { headers } from "next/headers";

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export async function registerAction(formData: FormData): Promise<ActionResult> {
  const ip = await clientIp();
  if (!rateLimit(`register:${ip}`, 5, 60_000)) {
    return { ok: false, error: "Too many attempts. Try again shortly." };
  }

  const parsed = registerSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { fullName, email, phone, password } = parsed.data;
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { phone }] },
  });
  if (existing) {
    return { ok: false, error: "An account with that email or phone already exists." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      fullName,
      email: email.toLowerCase(),
      phone,
      passwordHash,
      kyc: { create: {} },
    },
  });

  await writeAudit("user.register", { userId: user.id, ip });
  const h = await headers();
  await createSession(
    {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
    },
    { userAgent: h.get("user-agent") ?? undefined, ip },
  );

  redirect("/dashboard");
}

export async function loginAction(formData: FormData): Promise<ActionResult> {
  const ip = await clientIp();
  if (!rateLimit(`login:${ip}`, 10, 60_000)) {
    return { ok: false, error: "Too many attempts. Try again shortly." };
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid email or password." };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (!user) {
    return { ok: false, error: "Invalid email or password." };
  }

  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) {
    await writeAudit("user.login_failed", { userId: user.id, ip });
    return { ok: false, error: "Invalid email or password." };
  }

  const h = await headers();
  await createSession(
    {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
    },
    { userAgent: h.get("user-agent") ?? undefined, ip },
  );
  await writeAudit("user.login", { userId: user.id, ip });
  redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");
}

export async function logoutAction() {
  const user = await getSessionUser();
  await destroySession();
  if (user) await writeAudit("user.logout", { userId: user.id });
  redirect("/");
}

export async function submitKycAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = kycSchema.safeParse({
    bvn: formData.get("bvn"),
    nin: formData.get("nin"),
    bankName: formData.get("bankName"),
    accountNumber: formData.get("accountNumber"),
    accountName: formData.get("accountName"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { bvn, nin, bankName, accountNumber, accountName } = parsed.data;
  const check = await verifyKycIdentity({ bvn, nin, bankName, accountNumber, accountName });
  const status = check.status;

  await prisma.kycProfile.upsert({
    where: { userId: user.id },
    update: {
      bvnLast4: bvn.slice(-4),
      ninLast4: nin.slice(-4),
      bankName,
      accountNumber,
      accountName,
      status,
      submittedAt: new Date(),
      reviewNote: check.mode === "provider" ? check.message : null,
      reviewedAt: status === "APPROVED" || status === "REJECTED" ? new Date() : null,
    },
    create: {
      userId: user.id,
      bvnLast4: bvn.slice(-4),
      ninLast4: nin.slice(-4),
      bankName,
      accountNumber,
      accountName,
      status,
      submittedAt: new Date(),
      reviewNote: check.mode === "provider" ? check.message : null,
      reviewedAt: status === "APPROVED" || status === "REJECTED" ? new Date() : null,
    },
  });

  await writeAudit("kyc.submit", {
    userId: user.id,
    meta: { bvnLast4: bvn.slice(-4), ninLast4: nin.slice(-4), mode: check.mode, status },
  });
  void notifyAdmin("kyc.submitted", {
    userId: user.id,
    email: user.email,
    status,
    mode: check.mode,
  });

  return { ok: true, message: check.message };
}

export async function createCryptoSellAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const ip = await clientIp();
  if (!rateLimit(`crypto:${user.id}`, 15, 60_000)) {
    return { ok: false, error: "Too many orders. Slow down." };
  }

  const kyc = await prisma.kycProfile.findUnique({ where: { userId: user.id } });
  if (!kyc || kyc.status !== "APPROVED") {
    return { ok: false, error: "Complete and get KYC approved before trading." };
  }

  const parsed = cryptoSellSchema.safeParse({
    symbol: formData.get("symbol"),
    amountCrypto: formData.get("amountCrypto"),
    txHash: formData.get("txHash") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const rate = await prisma.rate.findUnique({
    where: { kind_symbol: { kind: "CRYPTO", symbol: parsed.data.symbol } },
  });
  if (!rate || !rate.isActive) {
    return { ok: false, error: "This asset is not available right now." };
  }
  if (parsed.data.amountCrypto < rate.minAmount) {
    return { ok: false, error: `Minimum is ${rate.minAmount} ${rate.symbol}.` };
  }
  if (rate.maxAmount && parsed.data.amountCrypto > rate.maxAmount) {
    return { ok: false, error: `Maximum is ${rate.maxAmount} ${rate.symbol}.` };
  }

  // Price from live NGN market at order time (not stale seed)
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
    // keep DB rate if market feed fails
  }

  const wallet = await prisma.platformWallet.findUnique({
    where: { symbol: parsed.data.symbol },
  });
  if (!wallet?.isActive) {
    return { ok: false, error: "Deposit wallet unavailable. Contact support." };
  }

  const amountNgn = parsed.data.amountCrypto * sellRateNgn;
  const order = await prisma.cryptoOrder.create({
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

  await writeAudit("crypto.sell_create", {
    userId: user.id,
    ip,
    meta: { reference: order.reference, symbol: order.symbol },
  });
  void notifyAdmin("crypto.sell_created", {
    reference: order.reference,
    symbol: order.symbol,
    amountCrypto: order.amountCrypto,
    amountNgn: order.amountNgn,
    userId: user.id,
  });

  return {
    ok: true,
    message: `Order ${order.reference} created. Send ${parsed.data.amountCrypto} ${order.symbol} (${order.network}) to ${order.depositAddress}, then submit your TX hash from Orders.`,
  };
}

export async function createCryptoBuyAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const ip = await clientIp();
  if (!rateLimit(`crypto-buy:${user.id}`, 15, 60_000)) {
    return { ok: false, error: "Too many orders. Slow down." };
  }

  const kyc = await prisma.kycProfile.findUnique({ where: { userId: user.id } });
  if (!kyc || kyc.status !== "APPROVED") {
    return { ok: false, error: "Complete and get KYC approved before trading." };
  }

  const parsed = cryptoBuySchema.safeParse({
    symbol: formData.get("symbol"),
    amountCrypto: formData.get("amountCrypto"),
    userReceiveAddress: formData.get("userReceiveAddress"),
    paymentRef: formData.get("paymentRef") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const rate = await prisma.rate.findUnique({
    where: { kind_symbol: { kind: "CRYPTO", symbol: parsed.data.symbol } },
  });
  if (!rate || !rate.isActive) {
    return { ok: false, error: "This asset is not available right now." };
  }
  if (parsed.data.amountCrypto < rate.minAmount) {
    return { ok: false, error: `Minimum is ${rate.minAmount} ${rate.symbol}.` };
  }
  if (rate.maxAmount && parsed.data.amountCrypto > rate.maxAmount) {
    return { ok: false, error: `Maximum is ${rate.maxAmount} ${rate.symbol}.` };
  }

  let buyRateNgn = rate.buyRateNgn;
  try {
    const market = await fetchNgnMarket();
    const desk = deskQuotesFromMarket(market);
    const live = desk[parsed.data.symbol as "USDT" | "BTC" | "ETH"];
    if (live) {
      buyRateNgn = live.buy;
      await prisma.rate.update({
        where: { id: rate.id },
        data: { sellRateNgn: live.sell, buyRateNgn: live.buy },
      });
    }
  } catch {
    // keep DB rate if market feed fails
  }

  const wallet = await prisma.platformWallet.findUnique({
    where: { symbol: parsed.data.symbol },
  });
  if (!wallet?.isActive) {
    return { ok: false, error: "Asset network unavailable. Contact support." };
  }

  const amountNgn = parsed.data.amountCrypto * buyRateNgn;
  const bank = platformBankDetails();
  const order = await prisma.cryptoOrder.create({
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

  await writeAudit("crypto.buy_create", {
    userId: user.id,
    ip,
    meta: { reference: order.reference, symbol: order.symbol },
  });
  void notifyAdmin("crypto.buy_created", {
    reference: order.reference,
    symbol: order.symbol,
    amountCrypto: order.amountCrypto,
    amountNgn: order.amountNgn,
    userId: user.id,
  });

  return {
    ok: true,
    message: `Order ${order.reference} created. Pay ${amountNgn.toLocaleString("en-NG", { style: "currency", currency: "NGN" })} to ${bank.accountName} · ${bank.bankName} · ${bank.accountNumber}, then submit your payment reference from Orders. Crypto goes to ${parsed.data.userReceiveAddress}.`,
  };
}

export async function submitCryptoTxAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const txHash = String(formData.get("txHash") ?? "").trim();
  if (!id || txHash.length < 8) {
    return { ok: false, error: "Provide a valid transaction hash." };
  }

  const order = await prisma.cryptoOrder.findFirst({
    where: { id, userId: user.id },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (!["AWAITING_DEPOSIT", "UNDER_REVIEW"].includes(order.status)) {
    return { ok: false, error: "This order can no longer be updated." };
  }

  await prisma.cryptoOrder.update({
    where: { id },
    data: { txHash, status: "UNDER_REVIEW" },
  });
  await writeAudit("crypto.tx_submit", { userId: user.id, meta: { id, txHash: maskSecret(txHash, 6) } });
  void notifyAdmin("crypto.tx_submitted", { orderId: id, userId: user.id });
  return { ok: true, message: "Transaction hash submitted. Our desk will verify and pay out." };
}

export async function submitBuyPaymentAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const paymentRef = String(formData.get("paymentRef") ?? "").trim();
  if (!id || paymentRef.length < 4) {
    return { ok: false, error: "Provide a valid bank payment reference." };
  }

  const order = await prisma.cryptoOrder.findFirst({
    where: { id, userId: user.id, side: "BUY" },
  });
  if (!order) return { ok: false, error: "Order not found." };
  if (!["AWAITING_DEPOSIT", "UNDER_REVIEW"].includes(order.status)) {
    return { ok: false, error: "This order can no longer be updated." };
  }

  await prisma.cryptoOrder.update({
    where: { id },
    data: { paymentRef, status: "UNDER_REVIEW" },
  });
  await writeAudit("crypto.payment_submit", {
    userId: user.id,
    meta: { id, paymentRef: maskSecret(paymentRef, 4) },
  });
  void notifyAdmin("crypto.payment_submitted", { orderId: id, reference: order.reference, userId: user.id });
  return { ok: true, message: "Payment reference submitted. Desk will verify and send crypto." };
}

export async function createGiftCardSellAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const ip = await clientIp();
  if (!rateLimit(`gift:${user.id}`, 10, 60_000)) {
    return { ok: false, error: "Too many orders. Slow down." };
  }

  const kyc = await prisma.kycProfile.findUnique({ where: { userId: user.id } });
  if (!kyc || kyc.status !== "APPROVED") {
    return { ok: false, error: "Complete and get KYC approved before trading." };
  }

  const parsed = giftCardSellSchema.safeParse({
    brand: formData.get("brand"),
    country: formData.get("country") || "USA",
    faceValueUsd: formData.get("faceValueUsd"),
    cardCode: formData.get("cardCode"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const rate = await prisma.rate.findUnique({
    where: { kind_symbol: { kind: "GIFTCARD", symbol: parsed.data.brand } },
  });
  if (!rate || !rate.isActive) {
    return { ok: false, error: "This gift card is not available right now." };
  }
  if (parsed.data.faceValueUsd < rate.minAmount) {
    return { ok: false, error: `Minimum face value is $${rate.minAmount}.` };
  }

  const sealed = encryptSecret(parsed.data.cardCode);
  const amountNgn = parsed.data.faceValueUsd * rate.sellRateNgn;

  const order = await prisma.giftCardOrder.create({
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
    },
  });

  await writeAudit("gift.sell_create", {
    userId: user.id,
    ip,
    meta: { reference: order.reference, brand: order.brand },
  });
  void notifyAdmin("gift.sell_created", {
    reference: order.reference,
    brand: order.brand,
    amountNgn: order.amountNgn,
    userId: user.id,
  });

  return {
    ok: true,
    message: `Gift card order ${order.reference} is under review. Code stored encrypted.`,
  };
}

export async function updateRateAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = rateUpdateSchema.safeParse({
    id: formData.get("id"),
    sellRateNgn: formData.get("sellRateNgn"),
    buyRateNgn: formData.get("buyRateNgn"),
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await prisma.rate.update({
    where: { id: parsed.data.id },
    data: {
      sellRateNgn: parsed.data.sellRateNgn,
      buyRateNgn: parsed.data.buyRateNgn,
      isActive: parsed.data.isActive ?? true,
    },
  });
  return { ok: true, message: "Rate updated." };
}

export async function updateCryptoOrderAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const triggerPayout =
    formData.get("triggerPayout") === "on" || formData.get("triggerPayout") === "true";
  const parsed = orderStatusSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
    adminNote: formData.get("adminNote") || undefined,
    payoutRef: formData.get("payoutRef") || undefined,
    triggerPayout,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const order = await prisma.cryptoOrder.findUnique({ where: { id: parsed.data.id } });
  if (!order) return { ok: false, error: "Order not found." };

  let payoutRef = parsed.data.payoutRef;
  let status = parsed.data.status;
  let payoutMessage = "";

  if (triggerPayout && order.side === "SELL" && paystackConfigured()) {
    if (!order.accountName || !order.accountNumber || !order.bankName) {
      return { ok: false, error: "Order missing bank details for Paystack payout." };
    }
    try {
      const result = await payoutSellOrder({
        amountNgn: order.amountNgn,
        accountName: order.accountName,
        accountNumber: order.accountNumber,
        bankName: order.bankName,
        orderReference: order.reference,
      });
      if (!result.ok) {
        return { ok: false, error: result.message };
      }
      payoutRef = result.payoutRef;
      status = "PAYOUT_SENT";
      payoutMessage = ` Paystack transfer ${result.payoutRef} initiated.`;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Paystack payout failed",
      };
    }
  }

  const data: {
    status: typeof status;
    adminNote?: string;
    payoutRef?: string;
    completedAt?: Date;
  } = {
    status,
    adminNote: parsed.data.adminNote,
    payoutRef,
  };
  if (status === "COMPLETED" || status === "PAYOUT_SENT") {
    data.completedAt = new Date();
  }

  await prisma.cryptoOrder.update({ where: { id: parsed.data.id }, data });
  await writeAudit("admin.crypto_status", {
    userId: admin.id,
    meta: { id: parsed.data.id, status, payoutRef, triggerPayout },
  });
  void notifyAdmin("admin.crypto_updated", {
    id: parsed.data.id,
    reference: order.reference,
    status,
    payoutRef,
  });
  return { ok: true, message: `Crypto order updated.${payoutMessage}` };
}

export async function updateGiftOrderAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const triggerPayout =
    formData.get("triggerPayout") === "on" || formData.get("triggerPayout") === "true";
  const parsed = orderStatusSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
    adminNote: formData.get("adminNote") || undefined,
    payoutRef: formData.get("payoutRef") || undefined,
    triggerPayout,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const order = await prisma.giftCardOrder.findUnique({ where: { id: parsed.data.id } });
  if (!order) return { ok: false, error: "Order not found." };

  let payoutRef = parsed.data.payoutRef;
  let status = parsed.data.status;
  let payoutMessage = "";

  if (triggerPayout && paystackConfigured()) {
    if (!order.accountName || !order.accountNumber || !order.bankName) {
      return { ok: false, error: "Order missing bank details for Paystack payout." };
    }
    try {
      const result = await payoutSellOrder({
        amountNgn: order.amountNgn,
        accountName: order.accountName,
        accountNumber: order.accountNumber,
        bankName: order.bankName,
        orderReference: order.reference,
      });
      if (!result.ok) {
        return { ok: false, error: result.message };
      }
      payoutRef = result.payoutRef;
      status = "PAYOUT_SENT";
      payoutMessage = ` Paystack transfer ${result.payoutRef} initiated.`;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Paystack payout failed",
      };
    }
  }

  const data: {
    status: typeof status;
    adminNote?: string;
    payoutRef?: string;
    completedAt?: Date;
  } = {
    status,
    adminNote: parsed.data.adminNote,
    payoutRef,
  };
  if (status === "COMPLETED" || status === "PAYOUT_SENT") {
    data.completedAt = new Date();
  }

  await prisma.giftCardOrder.update({ where: { id: parsed.data.id }, data });
  await writeAudit("admin.gift_status", {
    userId: admin.id,
    meta: { id: parsed.data.id, status, payoutRef, triggerPayout },
  });
  void notifyAdmin("admin.gift_updated", {
    id: parsed.data.id,
    reference: order.reference,
    status,
    payoutRef,
  });
  return { ok: true, message: `Gift card order updated.${payoutMessage}` };
}

export async function reviewKycAction(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const reviewNote = String(formData.get("reviewNote") ?? "");
  if (!id || !["APPROVED", "REJECTED"].includes(status)) {
    return { ok: false, error: "Invalid KYC review." };
  }

  await prisma.kycProfile.update({
    where: { id },
    data: {
      status: status as "APPROVED" | "REJECTED",
      reviewNote: reviewNote || null,
      reviewedAt: new Date(),
    },
  });
  await writeAudit("admin.kyc_review", {
    userId: admin.id,
    meta: { id, status },
  });
  return { ok: true, message: `KYC ${status.toLowerCase()}.` };
}

export async function updateWalletAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const symbol = String(formData.get("symbol") ?? "");
  const network = String(formData.get("network") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  if (!symbol || !network || address.length < 10) {
    return { ok: false, error: "Provide symbol, network, and address." };
  }
  await prisma.platformWallet.upsert({
    where: { symbol },
    update: { network, address, isActive: true },
    create: { symbol, network, address },
  });
  return { ok: true, message: "Deposit wallet updated." };
}
