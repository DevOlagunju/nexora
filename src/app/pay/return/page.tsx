import Link from "next/link";
import { SiteHeader } from "@/components/site-chrome";
import { settlePayment } from "@/lib/services/payments";
import { formatNgn } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Where the payment gateway sends the customer after checkout (web and mobile browser).
 * Public on purpose: the app's in-app browser has no session cookie. Settling is
 * idempotent and re-verified with the provider, and the page reveals only the outcome.
 */
export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; trxref?: string }>;
}) {
  const sp = await searchParams;
  const reference = (sp.reference ?? sp.trxref ?? "").slice(0, 80);
  const p = reference ? await settlePayment(reference, "return-page") : null;

  const view = !p
    ? { tone: "danger", title: "Payment not found", body: "We couldn't find this payment. If you were charged, contact support with your bank receipt." }
    : p.status === "SUCCESS"
      ? p.orderFunded
        ? { tone: "ok", title: "Payment confirmed", body: `${formatNgn(p.paidNgn ?? p.amountNgn)} received for order ${p.orderReference}. We're sending your crypto now.` }
        : { tone: "ok", title: "Money added", body: `${formatNgn(p.paidNgn ?? p.amountNgn)} is now in your Nexora wallet.` }
      : p.status === "PENDING"
        ? { tone: "wait", title: "Confirming your payment…", body: "Bank transfers can take a minute to arrive. This page updates on its own; you can also close it, and we'll notify you." }
        : { tone: "danger", title: "Payment not completed", body: "No money was taken. You can try again from your wallet or orders." };

  const color = view.tone === "ok" ? "text-accent-deep" : view.tone === "wait" ? "text-ink" : "text-danger";

  return (
    <>
      {view.tone === "wait" ? <meta httpEquiv="refresh" content="4" /> : null}
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="panel w-full max-w-md text-center" aria-live="polite">
          <p className="section-label">Payment {reference ? `· ${reference}` : ""}</p>
          <h1 className={`mt-2 font-[family-name:var(--font-display)] text-3xl font-bold ${color}`}>{view.title}</h1>
          <p className="mt-3 text-sm text-ink-soft">{view.body}</p>
          <div className="mt-6 grid gap-2">
            <Link href={p?.orderReference ? "/dashboard/orders" : "/dashboard/wallet"} className="btn btn-primary w-full">
              {p?.orderReference ? "View my order" : "Go to my wallet"}
            </Link>
            <p className="text-xs text-ink-soft">Using the Nexora app? Close this page to return to it.</p>
          </div>
        </div>
      </main>
    </>
  );
}
