/**
 * Paystack Transfer API (NGN payouts for sell orders).
 * Set PAYSTACK_SECRET_KEY in .env. Without it, admin marks payouts manually.
 * Docs: https://paystack.com/docs/transfers/
 */

const PAYSTACK_BASE = "https://api.paystack.co";

function secret() {
  return process.env.PAYSTACK_SECRET_KEY?.trim() ?? "";
}

export function paystackConfigured() {
  return secret().length > 10;
}

async function paystackFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = secret();
  if (!key) throw new Error("PAYSTACK_SECRET_KEY not set");

  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as { status: boolean; message: string; data: T };
  if (!res.ok || !data.status) {
    throw new Error(data.message || `Paystack error (${res.status})`);
  }
  return data.data;
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
  const amountKobo = Math.round(input.amountNgn * 100);
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

export async function payoutSellOrder(input: {
  amountNgn: number;
  accountName: string;
  accountNumber: string;
  bankName: string;
  orderReference: string;
}) {
  if (!paystackConfigured()) {
    return { ok: false as const, message: "Paystack not configured  -  mark payout manually." };
  }
  const bankCode = guessBankCode(input.bankName);
  if (!bankCode) {
    return {
      ok: false as const,
      message: `Unknown bank code for "${input.bankName}". Set PAYSTACK_DEFAULT_BANK_CODE or use admin payoutRef.`,
    };
  }
  const recipient = await createTransferRecipient({
    name: input.accountName,
    accountNumber: input.accountNumber,
    bankCode,
  });
  // Stable reference so Paystack rejects duplicate transfer attempts for the same order.
  const stableRef = `nxp-${input.orderReference.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40)}`;
  const transfer = await initiateNgnTransfer({
    amountNgn: input.amountNgn,
    recipientCode: recipient.recipient_code,
    reason: `Nexora payout ${input.orderReference}`,
    reference: stableRef,
  });
  return {
    ok: true as const,
    payoutRef: transfer.transfer_code,
    status: transfer.status,
  };
}
