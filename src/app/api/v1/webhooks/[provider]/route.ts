import { POST as paystackWebhook } from "@/app/api/webhooks/paystack/route";
import { handleDepositWebhook } from "@/lib/services/deposits";
import { depositProviderNamed } from "@/lib/deposits/provider";
import { fail } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhooks/:provider  Server-to-server callbacks.
 *   paystack     payments and payouts (signature checked in that handler)
 *   <deposit>    blockchain deposit providers, e.g. "simulated" outside production. Each webhook is
 *                stored before it is processed; an unsigned one is kept and never acted on.
 * /api/webhooks/paystack keeps working for the URL already saved in the Paystack dashboard.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (provider === "paystack") return paystackWebhook(request);
  if (depositProviderNamed(provider)) {
    const result = await handleDepositWebhook(provider, await request.text(), request.headers);
    return Response.json(result.body, { status: result.status });
  }
  return fail(404, "Unknown webhook provider.");
}
