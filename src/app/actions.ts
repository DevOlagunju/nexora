"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createSession, destroySession, destroyAllSessionsForUser, getSessionUser, requireAdmin, requireUser } from "@/lib/auth";
import { decryptSecret, encryptSecret, orderReference, maskSecret } from "@/lib/crypto";
import { rateLimit, writeAudit } from "@/lib/security";
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  kycSchema,
  cryptoSellSchema,
  cryptoBuySchema,
  giftCardSellSchema,
  rateUpdateSchema,
  orderStatusSchema,
} from "@/lib/validators";
import { requestPasswordReset, consumePasswordReset } from "@/lib/password-reset";
import { notifyAdmin } from "@/lib/notify";
import { notifyOrderStatus } from "@/lib/notify-user";
import { verifyKycIdentity } from "@/lib/kyc-provider";
import { paystackConfigured, payoutSellOrder } from "@/lib/paystack";
import { platformBankDetails } from "@/lib/platform-bank";
import { assertDailyTradeAllowed, assessGiftCardRisk } from "@/lib/trade-limits";
import { fetchReliableDeskBenchmark, deskQuotesFromBenchmark } from "@/lib/rate-benchmark";
import { headers } from "next/headers";

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** Refresh admin + user views after desk mutations */
function revalidateTradeViews() {
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/kyc");
  revalidatePath("/rates");
  revalidatePath("/");
}

export type ActionResult =
  | { ok: true; message?: string; code?: string }
  | { ok: false; error: string };

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

export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const ip = await clientIp();
  if (!rateLimit(`pwd:${user.id}`, 5, 60_000)) {
    return { ok: false, error: "Too many attempts. Try again shortly." };
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return { ok: false, error: "Account not found." };

  const valid = await bcrypt.compare(parsed.data.currentPassword, dbUser.passwordHash);
  if (!valid) {
    await writeAudit("user.password_change_failed", { userId: user.id, ip });
    return { ok: false, error: "Current password is incorrect." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  await destroyAllSessionsForUser(user.id);
  const h = await headers();
  await createSession(user, { userAgent: h.get("user-agent") ?? undefined, ip });

  await writeAudit("user.password_change", { userId: user.id, ip });
  revalidatePath("/dashboard/settings");
  return { ok: true, message: "Password updated. Other devices were signed out." };
}

export async function logoutAllSessionsAction(_formData?: FormData): Promise<ActionResult> {
  const user = await requireUser();
  await destroyAllSessionsForUser(user.id);
  await writeAudit("user.logout_all", { userId: user.id, ip: await clientIp() });
  redirect("/login");
}

export async function forgotPasswordAction(formData: FormData): Promise<ActionResult> {
  const ip = await clientIp();
  if (!rateLimit(`forgot:${ip}`, 5, 60_000)) {
    return { ok: false, error: "Too many attempts. Try again shortly." };
  }

  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid email" };
  }

  if (!rateLimit(`forgot-email:${parsed.data.email.toLowerCase()}`, 3, 15 * 60_000)) {
    return { ok: false, error: "Too many reset emails for this address. Try again later." };
  }

  const result = await requestPasswordReset(parsed.data.email);
  await writeAudit("user.password_reset_request", {
    ip,
    meta: { email: parsed.data.email.toLowerCase() },
  });

  const message =
    result.debugResetUrl && process.env.NODE_ENV !== "production"
      ? `${result.message} Dev link: ${result.debugResetUrl}`
      : result.message;

  return { ok: true, message };
}

export async function resetPasswordAction(formData: FormData): Promise<ActionResult> {
  const ip = await clientIp();
  if (!rateLimit(`reset:${ip}`, 8, 60_000)) {
    return { ok: false, error: "Too many attempts. Try again shortly." };
  }

  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const result = await consumePasswordReset({
    token: parsed.data.token,
    newPassword: parsed.data.newPassword,
  });
  if (!result.ok) {
    await writeAudit("user.password_reset_failed", { ip });
    return { ok: false, error: result.error };
  }

  await writeAudit("user.password_reset", { ip });
  return { ok: true, message: "Password updated. You can log in with your new password." };
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

  revalidateTradeViews();
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

  // Desk rate from admin DB (authoritative). Live market no longer overwrites these.
  const sellRateNgn = rate.sellRateNgn;

  const wallet = await prisma.platformWallet.findUnique({
    where: { symbol: parsed.data.symbol },
  });
  if (!wallet?.isActive) {
    return { ok: false, error: "Deposit wallet unavailable. Contact support." };
  }

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
    return { ok: false, error: err instanceof Error ? err.message : "Could not create order." };
  }

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

  revalidateTradeViews();
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

  const buyRateNgn = rate.buyRateNgn;

  const wallet = await prisma.platformWallet.findUnique({
    where: { symbol: parsed.data.symbol },
  });
  if (!wallet?.isActive) {
    return { ok: false, error: "Asset network unavailable. Contact support." };
  }

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
    return { ok: false, error: err instanceof Error ? err.message : "Could not create order." };
  }

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

  revalidateTradeViews();
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
  revalidateTradeViews();
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
  revalidateTradeViews();
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
  if (rate.maxAmount && parsed.data.faceValueUsd > rate.maxAmount) {
    return { ok: false, error: `Maximum face value is $${rate.maxAmount}.` };
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
    return { ok: false, error: err instanceof Error ? err.message : "Could not create order." };
  }

  await writeAudit("gift.sell_create", {
    userId: user.id,
    ip,
    meta: {
      reference: order.reference,
      brand: order.brand,
      fraudFlag: risk.fraudFlag,
      fraudNote: risk.fraudNote,
    },
  });
  void notifyAdmin("gift.sell_created", {
    reference: order.reference,
    brand: order.brand,
    amountNgn: order.amountNgn,
    userId: user.id,
    fraudFlag: risk.fraudFlag,
    fraudNote: risk.fraudNote,
  });

  revalidateTradeViews();
  return {
    ok: true,
    message: risk.fraudFlag
      ? `Gift card order ${order.reference} is under enhanced review.`
      : `Gift card order ${order.reference} is under review. Code stored encrypted.`,
  };
}

export async function updateRateAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Admin login required." };
  }
  const parsed = rateUpdateSchema.safeParse({
    id: formData.get("id"),
    sellRateNgn: formData.get("sellRateNgn"),
    buyRateNgn: formData.get("buyRateNgn"),
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid rate input" };
  }

  await prisma.rate.update({
    where: { id: parsed.data.id },
    data: {
      sellRateNgn: parsed.data.sellRateNgn,
      buyRateNgn: parsed.data.buyRateNgn,
      isActive: parsed.data.isActive ?? true,
    },
  });
  revalidateTradeViews();
  return {
    ok: true,
    message: `Rate saved: sell ${parsed.data.sellRateNgn} / buy ${parsed.data.buyRateNgn}.`,
  };
}

/** One-shot sync that survives CoinGecko HTTP 429. */
export async function syncLiveCryptoRatesAction(_formData?: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: "Admin login required." };
  }

  try {
    const [usdt, btc, eth] = await Promise.all([
      prisma.rate.findFirst({ where: { kind: "CRYPTO", symbol: "USDT" } }),
      prisma.rate.findFirst({ where: { kind: "CRYPTO", symbol: "BTC" } }),
      prisma.rate.findFirst({ where: { kind: "CRYPTO", symbol: "ETH" } }),
    ]);

    const usdtMid = usdt?.sellRateNgn ?? 1380;
    // Derive USD hints from current desk so sync still works offline of CG/Binance
    const btcUsdHint = btc && usdtMid > 0 ? btc.sellRateNgn / usdtMid : undefined;
    const ethUsdHint = eth && usdtMid > 0 ? eth.sellRateNgn / usdtMid : undefined;

    const benchmark = await fetchReliableDeskBenchmark({
      ngnMidHint: usdtMid,
      btcUsdHint,
      ethUsdHint,
    });
    const desk = deskQuotesFromBenchmark(benchmark);
    await Promise.all(
      (["USDT", "BTC", "ETH"] as const).map((symbol) =>
        prisma.rate.updateMany({
          where: { kind: "CRYPTO", symbol },
          data: {
            sellRateNgn: desk[symbol].sell,
            buyRateNgn: desk[symbol].buy,
            isActive: true,
          },
        }),
      ),
    );
    revalidateTradeViews();
    return {
      ok: true,
      message: `Synced (${benchmark.source}). USDT ${Math.round(desk.USDT.sell)} / ${Math.round(desk.USDT.buy)}. BTC sell ${Math.round(desk.BTC.sell).toLocaleString("en-NG")}.`,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Could not sync live rates.";
    // Never surface raw CoinGecko 429 to the admin UI
    const friendly = /429|busy|rate.?limit/i.test(raw)
      ? "Live feeds are busy right now. Your saved desk rates were kept - wait a minute or Save rate manually."
      : raw;
    return { ok: false, error: friendly };
  }
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
    if (order.payoutRef || order.status === "PAYOUT_SENT" || order.status === "COMPLETED") {
      return {
        ok: false,
        error: `Payout already recorded for ${order.reference}${order.payoutRef ? ` (${order.payoutRef})` : ""}. Do not re-trigger.`,
      };
    }
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
  const cryptoUser = await prisma.user.findUnique({
    where: { id: order.userId },
    select: { email: true },
  });
  void notifyAdmin("admin.crypto_updated", {
    id: parsed.data.id,
    reference: order.reference,
    status,
    payoutRef,
  });
  void notifyOrderStatus({
    userId: order.userId,
    email: cryptoUser?.email,
    reference: order.reference,
    status,
    channel: "crypto",
  });
  revalidateTradeViews();
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
    if (order.payoutRef || order.status === "PAYOUT_SENT" || order.status === "COMPLETED") {
      return {
        ok: false,
        error: `Payout already recorded for ${order.reference}${order.payoutRef ? ` (${order.payoutRef})` : ""}. Do not re-trigger.`,
      };
    }
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
  const giftUser = await prisma.user.findUnique({
    where: { id: order.userId },
    select: { email: true },
  });
  void notifyAdmin("admin.gift_updated", {
    id: parsed.data.id,
    reference: order.reference,
    status,
    payoutRef,
  });
  void notifyOrderStatus({
    userId: order.userId,
    email: giftUser?.email,
    reference: order.reference,
    status,
    channel: "gift",
  });
  revalidateTradeViews();
  return { ok: true, message: `Gift card order updated.${payoutMessage}` };
}

/** Admin-only: decrypt gift code on demand. Every reveal is audited. */
export async function revealGiftCardCodeAction(orderId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const id = String(orderId ?? "").trim();
  if (!id) return { ok: false, error: "Missing order id." };

  const order = await prisma.giftCardOrder.findUnique({
    where: { id },
    select: {
      id: true,
      reference: true,
      cardCodeEncrypted: true,
      cardCodeIv: true,
    },
  });
  if (!order) return { ok: false, error: "Order not found." };

  try {
    const code = decryptSecret(order.cardCodeEncrypted, order.cardCodeIv);
    await writeAudit("admin.gift_code_reveal", {
      userId: admin.id,
      meta: { id: order.id, reference: order.reference, masked: maskSecret(code) },
    });
    void notifyAdmin("admin.gift_code_revealed", {
      id: order.id,
      reference: order.reference,
      adminId: admin.id,
    });
    return { ok: true, code, message: "Code revealed (audited)." };
  } catch {
    return { ok: false, error: "Could not decrypt card code. Check ENCRYPTION_KEY." };
  }
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
  revalidateTradeViews();
  return { ok: true, message: `KYC ${status.toLowerCase()}.` };
}

export async function updateWalletAction(formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const symbol = String(formData.get("symbol") ?? "");
  const network = String(formData.get("network") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!symbol || !network || address.length < 10) {
    return { ok: false, error: "Provide symbol, network, and address." };
  }
  await prisma.platformWallet.upsert({
    where: { symbol },
    update: { network, address, note, isActive: true },
    create: { symbol, network, address, note },
  });
  revalidateTradeViews();
  return { ok: true, message: "Deposit wallet updated." };
}
