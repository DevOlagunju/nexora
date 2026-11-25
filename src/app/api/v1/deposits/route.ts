import { listRecentPayments, startWalletFunding } from "@/lib/services/payments";
import { authed, data, fromResult, pageSize } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/deposits?limit=  Recent Naira payments made through the payment gateway. */
export const GET = authed(async ({ user, query }) => {
  const payments = await listRecentPayments(user.id, pageSize(query, 10, 50));
  return data(
    payments.map((p) => ({
      reference: p.reference,
      purpose: p.purpose,
      status: p.status,
      amountNgn: p.amountNgn,
      paidNgn: p.paidNgn,
      channel: p.channel,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
    })),
  );
});

/**
 * POST /api/v1/deposits  (Idempotency-Key required)  { amountNgn } -> { checkout: { reference, authorizationUrl, provider } }
 * Opening a checkout credits nothing. The wallet is credited only after the provider confirms the payment.
 */
export const POST = authed(
  async ({ user, body, ctx }) => fromResult(await startWalletFunding(user, body, ctx), (checkout) => ({ checkout }), 201),
  { idempotent: true },
);
