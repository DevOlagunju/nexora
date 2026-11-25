"use server";

/**
 * Web server actions. Thin adapters: read FormData, call the shared domain
 * services in src/lib/services (also used by the mobile JSON API), revalidate.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  createSession,
  destroySession,
  destroyAllSessionsForUser,
  getSessionUser,
  requireAdmin,
  requireUser,
  type SessionUser,
} from "@/lib/auth";
import { ipFromHeaders, writeAudit } from "@/lib/security";
import type { ServiceResult } from "@/lib/services/result";
import {
  authenticate,
  changePassword,
  finishPasswordReset,
  registerUser,
  startPasswordReset,
} from "@/lib/services/accounts";
import { lookupBankAccount, reviewKyc, submitKyc } from "@/lib/services/kyc";
import {
  cancelUnfundedOrder,
  createCryptoBuyOrder,
  createCryptoSellOrder,
  createGiftCardSellOrder,
  submitBuyPaymentRef,
  submitCryptoTxHash,
} from "@/lib/services/trades";
import {
  revealGiftCode,
  syncDeskRatesFromMarket,
  updateOrderStatus,
  updateRate,
  verifyOrderPayout,
} from "@/lib/services/desk";
import {
  cancelWithdrawal,
  processWithdrawal,
  requestWithdrawal,
  setTransactionPin,
} from "@/lib/services/wallet";
import { markNotificationsRead } from "@/lib/services/notifications";
import { createRateAlert, deleteRateAlert } from "@/lib/services/rate-alerts";
import { startBuyOrderCheckout, startWalletFunding } from "@/lib/services/payments";
import { publicOrigin } from "@/lib/origin";
import { addAssetNetwork, updateAssetNetwork } from "@/lib/services/assets";
import { addGiftCardRate, updateGiftCardRate } from "@/lib/services/giftcards";
import { recordGiftRedemption } from "@/lib/services/reports";
import { resolveDeposit, simulateDeposit } from "@/lib/services/deposits";
import { can, denialMessage, orderUpdatePermission, type Permission } from "@/lib/permissions";

export type ActionResult =
  | { ok: true; message?: string; code?: string }
  | { ok: false; error: string };

async function requestCtx() {
  const h = await headers();
  return { ip: ipFromHeaders(h), userAgent: h.get("user-agent") ?? undefined, origin: publicOrigin(h) };
}

/** Refresh admin + user views after desk mutations */
function revalidateTradeViews() {
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/kyc");
  revalidatePath("/dashboard/wallet");
  revalidatePath("/rates");
  revalidatePath("/");
}

function toAction<T>(result: ServiceResult<T>, onOk?: () => void): ActionResult {
  if (!result.ok) return { ok: false, error: result.error };
  onOk?.();
  return { ok: true, message: result.message };
}

function fields(formData: FormData, ...names: string[]) {
  return Object.fromEntries(names.map((n) => [n, formData.get(n) ?? undefined]));
}

const checked = (formData: FormData, name: string) =>
  formData.get(name) === "on" || formData.get(name) === "true";

/** A signed-in staff member who holds `permission`, or the error to show them. Refusals are audited. */
async function staffOrError(permission: Permission): Promise<SessionUser | ActionResult> {
  let user: SessionUser;
  try {
    user = await requireAdmin();
  } catch {
    return { ok: false, error: "Admin login required." };
  }
  if (!can(user, permission)) {
    await writeAudit("admin.permission_denied", { userId: user.id, meta: { permission, staffRole: user.staffRole ?? null } });
    return { ok: false, error: denialMessage(user, permission) };
  }
  return user;
}

async function userOrError(): Promise<SessionUser | ActionResult> {
  try {
    return await requireUser();
  } catch {
    return { ok: false, error: "Please log in again." };
  }
}

const isActionResult = (v: unknown): v is ActionResult =>
  typeof v === "object" && v !== null && "ok" in v;

/* ---------------------------------- auth --------------------------------- */

export async function registerAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requestCtx();
  const result = await registerUser(fields(formData, "fullName", "email", "phone", "password", "referralCode"), ctx);
  if (!result.ok) return { ok: false, error: result.error };
  await createSession(result.data, ctx);
  redirect("/dashboard");
}

export async function loginAction(formData: FormData): Promise<ActionResult> {
  const ctx = await requestCtx();
  const result = await authenticate(fields(formData, "email", "password"), ctx);
  if (!result.ok) return { ok: false, error: result.error };
  await createSession(result.data, ctx);
  redirect(result.data.role === "ADMIN" ? "/admin" : "/dashboard");
}

export async function logoutAction() {
  const user = await getSessionUser();
  await destroySession();
  if (user) await writeAudit("user.logout", { userId: user.id });
  redirect("/");
}

export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const ctx = await requestCtx();
  const result = await changePassword(
    user,
    fields(formData, "currentPassword", "newPassword", "confirmPassword"),
    { ...ctx, setCookie: true },
  );
  return toAction(result, () => revalidatePath("/dashboard/settings"));
}

export async function logoutAllSessionsAction(): Promise<ActionResult> {
  const user = await requireUser();
  await destroyAllSessionsForUser(user.id);
  await writeAudit("user.logout_all", { userId: user.id, ip: (await requestCtx()).ip });
  redirect("/login");
}

export async function forgotPasswordAction(formData: FormData): Promise<ActionResult> {
  const result = await startPasswordReset(fields(formData, "email"), await requestCtx());
  if (!result.ok) return { ok: false, error: result.error };
  const message = result.data.debugResetUrl
    ? `${result.message} Dev link: ${result.data.debugResetUrl}`
    : result.message;
  return { ok: true, message };
}

export async function resetPasswordAction(formData: FormData): Promise<ActionResult> {
  const result = await finishPasswordReset(
    fields(formData, "token", "newPassword", "confirmPassword"),
    await requestCtx(),
  );
  return toAction(result);
}

/* -------------------------------- customer ------------------------------- */

export async function submitKycAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const result = await submitKyc(
    user,
    fields(formData, "bvn", "nin", "bankCode", "bankName", "accountNumber", "accountName"),
    await requestCtx(),
  );
  return toAction(result, revalidateTradeViews);
}

export async function createCryptoSellAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const input = fields(formData, "symbol", "network", "amountCrypto", "txHash", "payoutMethod");
  if (!input.txHash) delete input.txHash;
  return toAction(await createCryptoSellOrder(user, input, await requestCtx()), revalidateTradeViews);
}

export async function createCryptoBuyAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const input = fields(formData, "symbol", "network", "amountCrypto", "userReceiveAddress", "paymentRef", "payFrom");
  if (!input.paymentRef) delete input.paymentRef;
  const ctx = await requestCtx();
  const result = await createCryptoBuyOrder(user, input, ctx);
  if (!result.ok || input.payFrom !== "CARD") return toAction(result, revalidateTradeViews);
  revalidateTradeViews();
  const checkout = await startBuyOrderCheckout(user, { orderId: result.data.order.id }, ctx);
  if (!checkout.ok) {
    return { ok: false, error: `Order ${result.data.order.reference} was created, but ${checkout.error} You can pay from Orders.` };
  }
  redirect(checkout.data.authorizationUrl);
}

/** "Pay now" on an unfunded buy order. */
export async function payBuyOrderAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const checkout = await startBuyOrderCheckout(user, { orderId: formData.get("id") ?? undefined }, await requestCtx());
  if (!checkout.ok) return { ok: false, error: checkout.error };
  redirect(checkout.data.authorizationUrl);
}

/** Add money to the wallet by card / transfer / USSD on the gateway checkout. */
export async function startWalletFundingAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const checkout = await startWalletFunding(user, fields(formData, "amountNgn"), await requestCtx());
  if (!checkout.ok) return { ok: false, error: checkout.error };
  redirect(checkout.data.authorizationUrl);
}

export async function submitCryptoTxAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const result = await submitCryptoTxHash(user, fields(formData, "id", "txHash"), await requestCtx());
  return toAction(result, revalidateTradeViews);
}

export async function submitBuyPaymentAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const result = await submitBuyPaymentRef(user, fields(formData, "id", "paymentRef"), await requestCtx());
  return toAction(result, revalidateTradeViews);
}

export async function cancelCryptoOrderAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const result = await cancelUnfundedOrder(user, fields(formData, "id"), await requestCtx());
  return toAction(result, revalidateTradeViews);
}

export async function createGiftCardSellAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const input = fields(formData, "brand", "country", "cardType", "faceValueUsd", "cardCode", "payoutMethod");
  return toAction(await createGiftCardSellOrder(user, input, await requestCtx()), revalidateTradeViews);
}

/* ---------------------------------- desk --------------------------------- */

export async function updateRateAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError("rates.manage");
  if (isActionResult(admin)) return admin;
  const result = await updateRate(admin, {
    ...fields(formData, "id", "sellRateNgn", "buyRateNgn", "sellSpreadPct", "buySpreadPct"),
    isActive: checked(formData, "isActive"),
  });
  return toAction(result, revalidateTradeViews);
}

/** Change one gift card variant (brand + country + card type): price, limits, accepted values, on/off, default. */
export async function updateGiftCardRateAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError("rates.manage");
  if (isActionResult(admin)) return admin;
  const result = await updateGiftCardRate(
    admin,
    fields(formData, "id", "rateNgn", "minFaceUsd", "maxFaceUsd", "denominations", "isActive", "isDefault"),
  );
  return toAction(result, revalidateTradeViews);
}

/** Price a new country or card type for a brand. */
export async function addGiftCardRateAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError("rates.manage");
  if (isActionResult(admin)) return admin;
  const result = await addGiftCardRate(
    admin,
    fields(formData, "brand", "country", "cardType", "rateNgn", "minFaceUsd", "maxFaceUsd", "denominations"),
  );
  return toAction(result, revalidateTradeViews);
}

/** One-shot sync that survives CoinGecko HTTP 429. */
export async function syncLiveCryptoRatesAction(): Promise<ActionResult> {
  const admin = await staffOrError("rates.manage");
  if (isActionResult(admin)) return admin;
  const result = await syncDeskRatesFromMarket();
  if (result.ok) await writeAudit("admin.rates_sync", { userId: admin.id, meta: { source: result.data.source } });
  return toAction(result, revalidateTradeViews);
}

export async function updateCryptoOrderAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError(orderUpdatePermission({ status: String(formData.get("status") ?? ""), triggerPayout: checked(formData, "triggerPayout") }));
  if (isActionResult(admin)) return admin;
  const result = await updateOrderStatus(admin, "crypto", {
    ...fields(formData, "id", "status", "adminNote", "payoutRef"),
    triggerPayout: checked(formData, "triggerPayout"),
  });
  return toAction(result, revalidateTradeViews);
}

export async function updateGiftOrderAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError(orderUpdatePermission({ status: String(formData.get("status") ?? ""), triggerPayout: checked(formData, "triggerPayout") }));
  if (isActionResult(admin)) return admin;
  const result = await updateOrderStatus(admin, "gift", {
    ...fields(formData, "id", "status", "adminNote", "payoutRef"),
    triggerPayout: checked(formData, "triggerPayout"),
  });
  return toAction(result, revalidateTradeViews);
}

/** Ask Paystack what happened to an order's payout (unconfirmed transfer or missed webhook). */
export async function verifyOrderPayoutAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError("payouts.verify");
  if (isActionResult(admin)) return admin;
  const channel = formData.get("channel") === "gift" ? "gift" : "crypto";
  return toAction(await verifyOrderPayout(admin, channel, fields(formData, "id")), revalidateTradeViews);
}

/** Record what the desk got for a gift card, for the earnings report. */
export async function recordGiftRedemptionAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError("orders.review");
  if (isActionResult(admin)) return admin;
  return toAction(await recordGiftRedemption(admin, fields(formData, "id", "redeemedNgn")), revalidateTradeViews);
}

/** Close a deposit exception once someone has dealt with it. */
export async function resolveDepositAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError("orders.review");
  if (isActionResult(admin)) return admin;
  return toAction(await resolveDeposit(admin, fields(formData, "id", "note")), revalidateTradeViews);
}

/** Local testing only: pretend the simulated provider saw a transfer. Refused in production. */
export async function simulateDepositAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError("orders.review");
  if (isActionResult(admin)) return admin;
  const result = await simulateDeposit(admin, {
    ...fields(formData, "toAddress", "network", "symbol", "amount", "confirmations", "txHash"),
    dropped: checked(formData, "dropped"),
  });
  return toAction(result, revalidateTradeViews);
}

/** Admin-only: decrypt gift code on demand. Every reveal is audited. */
export async function revealGiftCardCodeAction(orderId: string): Promise<ActionResult> {
  const admin = await staffOrError("giftcards.reveal");
  if (isActionResult(admin)) return admin;
  const result = await revealGiftCode(admin, orderId);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, code: result.data.code, message: result.message };
}

export async function reviewKycAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError("kyc.review");
  if (isActionResult(admin)) return admin;
  const result = await reviewKyc(admin, fields(formData, "id", "status", "reviewNote"));
  return toAction(result, revalidateTradeViews);
}

/** Change an asset's settings on one network (deposit address, confirmations, on/off, default). */
export async function updateAssetNetworkAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError("wallets.manage");
  if (isActionResult(admin)) return admin;
  const result = await updateAssetNetwork(
    admin,
    fields(formData, "id", "depositAddress", "depositMemo", "confirmations", "depositsEnabled", "withdrawalsEnabled", "isDefault", "note"),
  );
  return toAction(result, revalidateTradeViews);
}

/** Put an asset on another network. It starts switched off. */
export async function addAssetNetworkAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError("wallets.manage");
  if (isActionResult(admin)) return admin;
  const result = await addAssetNetwork(admin, fields(formData, "symbol", "networkId", "depositAddress", "depositMemo", "note"));
  return toAction(result, revalidateTradeViews);
}

/* --------------------------------- wallet -------------------------------- */

function revalidateWallet() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/wallet");
  revalidatePath("/admin");
}

export async function setTransactionPinAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const result = await setTransactionPin(user, fields(formData, "password", "pin", "confirmPin"), await requestCtx());
  return toAction(result, () => {
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/wallet");
  });
}

export async function requestWithdrawalAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const result = await requestWithdrawal(user, fields(formData, "amountNgn", "pin"), await requestCtx());
  return toAction(result, revalidateWallet);
}

export async function cancelWithdrawalAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  return toAction(await cancelWithdrawal(user, fields(formData, "id")), revalidateWallet);
}

export async function processWithdrawalAction(formData: FormData): Promise<ActionResult> {
  const admin = await staffOrError(formData.get("action") === "verify" ? "payouts.verify" : "withdrawals.process");
  if (isActionResult(admin)) return admin;
  const result = await processWithdrawal(admin, fields(formData, "id", "action", "payoutRef", "note"));
  return toAction(result, revalidateWallet);
}

export async function markNotificationsReadAction(): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const count = await markNotificationsRead(user.id);
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: count ? `Marked ${count} as read.` : "You're all caught up." };
}

export async function createRateAlertAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  const result = await createRateAlert(user, fields(formData, "rateId", "side", "direction", "targetNgn"));
  return toAction(result, () => revalidatePath("/dashboard/alerts"));
}

export async function deleteRateAlertAction(formData: FormData): Promise<ActionResult> {
  const user = await userOrError();
  if (isActionResult(user)) return user;
  return toAction(await deleteRateAlert(user, fields(formData, "id")), () => revalidatePath("/dashboard/alerts"));
}

/** Live bank account-name lookup for the KYC form (returns data, not just a message). */
export async function lookupBankAccountAction(input: {
  bankCode: string;
  accountNumber: string;
}): Promise<
  | { ok: true; accountName: string; bankName: string; nameMatch: boolean; mode: "live" | "test" }
  | { ok: false; error: string }
> {
  const user = await userOrError();
  if (isActionResult(user)) return { ok: false, error: "Please log in again." };
  const result = await lookupBankAccount(user, input);
  return result.ok ? { ok: true, ...result.data } : { ok: false, error: result.error };
}
