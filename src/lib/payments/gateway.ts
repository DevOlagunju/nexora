import "server-only";
import { paystackConfigured, paystackFetch } from "@/lib/paystack";
import { koboToNgn, ngnToKobo } from "@/lib/money";
import { mapGatewayStatus, type GatewayState } from "@/lib/payment-rules";

/**
 * Payment collection behind one interface, so the provider can be swapped
 * (Paystack today; Flutterwave/Kora/others later) without touching order or wallet code.
 */

export type CheckoutInput = {
  reference: string;
  amountNgn: number;
  email: string;
  callbackUrl: string;
  metadata?: Record<string, string>;
};

export type VerifiedPayment = {
  state: GatewayState;
  /** Amount actually paid, in Naira, as reported by the provider. */
  paidNgn: number;
  currency: string;
  channel: string | null;
  paidAt: Date | null;
  message: string | null;
};

export interface PaymentGateway {
  readonly name: string;
  initCheckout(input: CheckoutInput): Promise<{ authorizationUrl: string }>;
  verify(reference: string): Promise<VerifiedPayment>;
}

type PaystackTx = {
  status?: string;
  amount?: number;
  currency?: string;
  channel?: string;
  paid_at?: string | null;
  gateway_response?: string;
};

const paystack: PaymentGateway = {
  name: "paystack",
  async initCheckout(input) {
    const data = await paystackFetch<{ authorization_url: string }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        amount: ngnToKobo(input.amountNgn),
        currency: "NGN",
        reference: input.reference,
        callback_url: input.callbackUrl,
        // Cards (incl. virtual cards), transfer, USSD, pay-with-bank. Paystack hides any not enabled on the account.
        channels: ["card", "bank_transfer", "ussd", "bank"],
        metadata: input.metadata,
      }),
    });
    return { authorizationUrl: data.authorization_url };
  },
  async verify(reference) {
    const tx = await paystackFetch<PaystackTx>(`/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      state: mapGatewayStatus(tx.status),
      paidNgn: koboToNgn(tx.amount ?? 0),
      currency: tx.currency ?? "NGN",
      channel: tx.channel ?? null,
      paidAt: tx.paid_at ? new Date(tx.paid_at) : null,
      message: tx.gateway_response ?? null,
    };
  },
};

/**
 * Local test checkout (non-production only, used when no gateway keys are set).
 * The /pay/test page records the outcome in Payment.providerNote; verify() reads it back.
 */
export const TEST_PAID = "test:paid";
export const TEST_CANCELLED = "test:cancelled";

function testGateway(lookup: (reference: string) => Promise<{ amountNgn: number; providerNote: string | null } | null>): PaymentGateway {
  return {
    name: "test",
    async initCheckout(input) {
      const base = new URL(input.callbackUrl);
      return { authorizationUrl: `${base.origin}/pay/test/${encodeURIComponent(input.reference)}` };
    },
    async verify(reference) {
      const p = await lookup(reference);
      const state: GatewayState =
        p?.providerNote === TEST_PAID ? "success" : p?.providerNote === TEST_CANCELLED ? "abandoned" : "pending";
      return {
        state,
        paidNgn: state === "success" ? (p?.amountNgn ?? 0) : 0,
        currency: "NGN",
        channel: state === "success" ? "test" : null,
        paidAt: state === "success" ? new Date() : null,
        message: state === "pending" ? "Waiting for test payment" : null,
      };
    },
  };
}

export function testGatewayAllowed() {
  return process.env.NODE_ENV !== "production";
}

/** The gateway for new payments, or null when none is configured (production without keys). */
export function activeGatewayName(): "paystack" | "test" | null {
  if (paystackConfigured()) return "paystack";
  return testGatewayAllowed() ? "test" : null;
}

/** Gateway that created a given payment (a payment is always verified by the provider that took it). */
export function gatewayFor(
  name: string,
  lookup: (reference: string) => Promise<{ amountNgn: number; providerNote: string | null } | null>,
): PaymentGateway | null {
  if (name === "paystack") return paystackConfigured() ? paystack : null;
  if (name === "test") return testGatewayAllowed() ? testGateway(lookup) : null;
  return null;
}
