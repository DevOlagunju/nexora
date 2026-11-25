/**
 * Paystack Transfer API (NGN payouts for sell orders).
 * Set PAYSTACK_SECRET_KEY in .env. Without it, admin marks payouts manually.
 * Docs: https://paystack.com/docs/transfers/
 */

import { hmacHex, safeEqual } from "@/lib/crypto";
import { ngnToKobo } from "@/lib/money";

const PAYSTACK_BASE = "https://api.paystack.co";
const PAYSTACK_TIMEOUT_MS = 20_000;

function secret() {
  return process.env.PAYSTACK_SECRET_KEY?.trim() ?? "";
}

/** Paystack signs webhooks with HMAC-SHA512(rawBody, secretKey) in x-paystack-signature. */
export function verifyPaystackSignature(rawBody: string, signature: string | null, secretKey: string): boolean {
  if (!signature || !secretKey) return false;
  return safeEqual(hmacHex("sha512", secretKey, rawBody), signature.trim().toLowerCase());
}

export function paystackConfigured() {
  return secret().length > 10;
}

/**
 * A failed Paystack call. `httpStatus` is 0 when no response arrived (timeout, network),
 * which matters for transfers: no response does not mean the transfer was not created.
 */
export class PaystackError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "PaystackError";
  }
}

export async function paystackFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = secret();
  if (!key) throw new PaystackError("PAYSTACK_SECRET_KEY not set", 400);

  let res: Response;
  try {
    res = await fetch(`${PAYSTACK_BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    throw new PaystackError(
      name === "TimeoutError" || name === "AbortError" ? "Paystack did not respond in time" : "Could not reach Paystack",
      0,
    );
  }
  const data = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data: T } | null;
  if (!res.ok || !data?.status) {
    // A 2xx we cannot read is as uncertain as no response at all.
    throw new PaystackError(data?.message || `Paystack error (${res.status})`, res.ok ? 0 : res.status);
  }
  return data.data;
}

/**
 * True when a failed transfer request may still have created a transfer: no readable
 * response, a Paystack-side error, or a "reference already used" rejection (which means
 * an earlier attempt with this reference got through). Only a clean 4xx is a definite no.
 */
export function transferOutcomeUnknown(err: unknown): boolean {
  if (!(err instanceof PaystackError)) return true;
  if (err.httpStatus === 0 || err.httpStatus === 408 || err.httpStatus >= 500) return true;
  return /reference/i.test(err.message) && /duplicate|unique|exist|already/i.test(err.message);
}

/** Resolve Paystack bank code from common Nigerian bank names (subset). */
export function guessBankCode(bankName: string): string | null {
  const n = bankName.toLowerCase();
  const map: Record<string, string> = {
    access: "044",
    gtbank: "058",
    guaranty: "058",
    uba: "033",
    zenith: "057",
    first: "011",
    fidelity: "070",
    union: "032",
    sterling: "232",
    polaris: "076",
    kuda: "50211",
    opay: "100004",
    palmpay: "100033",
    wema: "035",
  };
  for (const [k, code] of Object.entries(map)) {
    if (n.includes(k)) return code;
  }
  return process.env.PAYSTACK_DEFAULT_BANK_CODE ?? null;
}

export async function createTransferRecipient(input: {
  name: string;
  accountNumber: string;
  bankCode: string;
}) {
  return paystackFetch<{ recipient_code: string }>("/transferrecipient", {
    method: "POST",
    body: JSON.stringify({
      type: "nuban",
      name: input.name,
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: "NGN",
    }),
  });
}

/** Amount in NGN  -  Paystack expects kobo (x100). */
export async function initiateNgnTransfer(input: {
  amountNgn: number;
  recipientCode: string;
  reason: string;
  reference: string;
}) {
  const amountKobo = ngnToKobo(input.amountNgn);
  return paystackFetch<{ transfer_code: string; status: string }>("/transfer", {
    method: "POST",
    body: JSON.stringify({
      source: "balance",
      amount: amountKobo,
      recipient: input.recipientCode,
      reason: input.reason,
      reference: input.reference,
      currency: "NGN",
    }),
  });
}

const TRANSFER_REF_PREFIX = "nxp-";

/** The Paystack transfer reference for an order/withdrawal. Stable, so Paystack rejects a second send. */
export function transferReference(reference: string): string {
  return `${TRANSFER_REF_PREFIX}${reference.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40)}`;
}

/** Inverse of transferReference(): the Nexora reference a Paystack transfer belongs to, if it is ours. */
export function referenceFromTransfer(transferRef: string | null | undefined): string | null {
  if (!transferRef?.startsWith(TRANSFER_REF_PREFIX)) return null;
  return transferRef.slice(TRANSFER_REF_PREFIX.length) || null;
}

export type TransferState = "success" | "pending" | "failed" | "not_found";

/** Paystack transfer statuses -> our states. Unknown values stay pending (never assume money moved or didn't). */
export function mapTransferStatus(status: string | undefined | null): Exclude<TransferState, "not_found"> {
  switch ((status ?? "").toLowerCase()) {
    case "success":
      return "success";
    case "failed":
    case "reversed":
    case "abandoned":
    case "blocked":
    case "rejected":
      return "failed";
    default:
      return "pending";
  }
}

export type VerifiedTransfer = { state: TransferState; transferCode: string | null; reason: string | null };

/**
 * Ask Paystack what happened to the transfer for a Nexora reference.
 * Throws when Paystack cannot be asked; "not_found" only when Paystack says it has no such transfer.
 */
export async function verifyTransfer(reference: string): Promise<VerifiedTransfer> {
  try {
    const t = await paystackFetch<{ status?: string; transfer_code?: string; reason?: string; gateway_response?: string }>(
      `/transfer/verify/${encodeURIComponent(transferReference(reference))}`,
    );
    return {
      state: mapTransferStatus(t.status),
      transferCode: t.transfer_code ?? null,
      reason: t.gateway_response ?? t.reason ?? null,
    };
  } catch (err) {
    if (
      err instanceof PaystackError &&
      (err.httpStatus === 404 || (err.httpStatus === 400 && /not found/i.test(err.message)))
    ) {
      return { state: "not_found", transferCode: null, reason: null };
    }
    throw err;
  }
}

export type PayoutResult =
  | { ok: true; payoutRef: string; status: string }
  /** `unknown: true` means the transfer may have been created; it must be verified, never re-sent or refunded. */
  | { ok: false; unknown: boolean; message: string };

/** Send NGN to a Nigerian bank account. `reference` is made stable so Paystack rejects duplicates. */
export async function payoutToBank(input: {
  amountNgn: number;
  accountName: string;
  accountNumber: string;
  bankName: string;
  /** Exact Paystack bank code from KYC. Falls back to guessing from the bank name. */
  bankCode?: string | null;
  reference: string;
  reason: string;
}): Promise<PayoutResult> {
  if (!paystackConfigured()) {
    return { ok: false, unknown: false, message: "Paystack not configured  -  mark payout manually." };
  }
  const bankCode = input.bankCode || guessBankCode(input.bankName);
  if (!bankCode) {
    return {
      ok: false,
      unknown: false,
      message: `Unknown bank code for "${input.bankName}". Set PAYSTACK_DEFAULT_BANK_CODE or use admin payoutRef.`,
    };
  }
  let recipientCode: string;
  try {
    // No money moves here, so any failure is a definite "not sent".
    const recipient = await createTransferRecipient({
      name: input.accountName,
      accountNumber: input.accountNumber,
      bankCode,
    });
    recipientCode = recipient.recipient_code;
  } catch (err) {
    return { ok: false, unknown: false, message: err instanceof Error ? err.message : "Paystack recipient failed" };
  }
  try {
    const transfer = await initiateNgnTransfer({
      amountNgn: input.amountNgn,
      recipientCode,
      reason: input.reason,
      reference: transferReference(input.reference),
    });
    return { ok: true, payoutRef: transfer.transfer_code, status: transfer.status };
  } catch (err) {
    return {
      ok: false,
      unknown: transferOutcomeUnknown(err),
      message: err instanceof Error ? err.message : "Paystack transfer failed",
    };
  }
}

export function payoutSellOrder(input: {
  amountNgn: number;
  accountName: string;
  accountNumber: string;
  bankName: string;
  bankCode?: string | null;
  orderReference: string;
}) {
  const { orderReference, ...rest } = input;
  return payoutToBank({ ...rest, reference: orderReference, reason: `Nexora payout ${orderReference}` });
}
