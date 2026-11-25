import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { testGatewayAllowed } from "@/lib/payments/gateway";
import { completeTestPayment } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

/** Simulated checkout for development (no gateway keys). Never served in production. */
export default async function TestCheckoutPage({ params }: { params: Promise<{ reference: string }> }) {
  if (!testGatewayAllowed()) notFound();
  const { reference } = await params;
  const p = await prisma.payment.findUnique({ where: { reference } });
  if (!p || p.provider !== "test") notFound();

  async function decide(formData: FormData) {
    "use server";
    if (!testGatewayAllowed()) notFound();
    const outcome = formData.get("outcome") === "paid" ? "paid" : "cancelled";
    await completeTestPayment(reference, outcome);
    redirect(`/pay/return?reference=${encodeURIComponent(reference)}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-12">
      <div className="panel w-full max-w-sm">
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          TEST CHECKOUT · no real money moves. Add PAYSTACK_SECRET_KEY to use the live Paystack page.
        </p>
        <p className="mt-5 text-sm text-ink-soft">Pay Nexora</p>
        <p className="font-[family-name:var(--font-display)] text-4xl font-bold">{formatNgn(p.amountNgn)}</p>
        <p className="mt-1 text-xs text-ink-soft">Ref {p.reference}</p>
        {p.status !== "PENDING" ? (
          <p className="mt-6 text-sm">This payment is already {p.status.toLowerCase()}.</p>
        ) : (
          <form action={decide} className="mt-6 grid gap-2">
            <button name="outcome" value="paid" className="btn btn-primary w-full">
              Pay {formatNgn(p.amountNgn)} (test card)
            </button>
            <button name="outcome" value="cancelled" className="btn btn-ghost w-full">
              Cancel payment
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
