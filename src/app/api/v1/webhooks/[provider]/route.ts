import { POST as paystackWebhook } from "@/app/api/webhooks/paystack/route";
import { fail } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhooks/:provider  Server-to-server callbacks from payment providers.
 * Each provider verifies its own signature; an unsigned or unknown call changes nothing.
 * /api/webhooks/paystack keeps working for the URL already saved in the Paystack dashboard.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (provider === "paystack") return paystackWebhook(request);
  return fail(404, "Unknown webhook provider.");
}
