import { redirect } from "next/navigation";
import { cancelCryptoOrderAction, payBuyOrderAction, submitBuyPaymentAction, submitCryptoTxAction } from "@/app/actions";
import { activeGatewayName } from "@/lib/payments/gateway";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { countryName } from "@/lib/giftcard-rules";
import { isFailedOrderStatus } from "@/lib/support";
import { ActionForm } from "@/components/action-form";
import { ContactSupport } from "@/components/contact-support";
import { StatusPill } from "@/components/status-pill";

export default async function OrdersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [cryptoOrders, giftOrders] = await Promise.all([
    prisma.cryptoOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.giftCardOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const instantPay = !!activeGatewayName();
  const walletPaid = (ref: string | null) => !!ref && ref.startsWith("wallet:");

  return (
    <>
      <p className="section-label">Orders</p>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">Your orders</h1>
      <p className="mt-2 text-sm text-ink-soft">Track deposits, reviews, and payouts in one place.</p>

      <section className="mt-8">
        <h2 className="font-semibold">Crypto</h2>
        <div className="mt-3 space-y-4">
          {cryptoOrders.length === 0 && <p className="text-sm text-ink-soft">No crypto orders yet.</p>}
          {cryptoOrders.map((o) => (
            <article key={o.id} id={`order-${o.id}`} className="panel order-anchor text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {o.reference} · {o.side}
                  </p>
                  <p className="text-ink-soft">
                    {o.amountCrypto} {o.symbol} ({o.network})
                    <span className="mx-1.5 text-[var(--line)]">·</span>
                    <span className="font-medium tabular-nums text-accent-deep">
                      {formatNgn(o.amountNgn)}
                    </span>
                  </p>
                  <div className="mt-2">
                    <StatusPill status={o.status} />
                  </div>
                  {o.adminNote && o.status === "REJECTED" && (
                    <p className="mt-2 text-xs text-danger">Note: {o.adminNote}</p>
                  )}
                </div>
                {o.side === "SELL" ? (
                  <p className="max-w-xs break-all text-xs text-ink-soft">
                    Deposit: {o.depositAddress}
                  </p>
                ) : (
                  <p className="max-w-xs break-all text-xs text-ink-soft">
                    Receive: {o.userReceiveAddress}
                    <br />
                    {walletPaid(o.paymentRef) ? "Paid · confirmed instantly" : `Pay: ${o.bankName} ${o.accountNumber}`}
                  </p>
                )}
              </div>
              {o.side === "SELL" && ["AWAITING_DEPOSIT", "UNDER_REVIEW"].includes(o.status) && (
                <ActionForm action={submitCryptoTxAction} className="mt-4 border-t border-[var(--line)] pt-4">
                  <input type="hidden" name="id" value={o.id} />
                  <label className="block text-sm font-medium">
                    Transaction hash
                    <input className="input mt-1" name="txHash" defaultValue={o.txHash ?? ""} required />
                  </label>
                </ActionForm>
              )}
              {o.side === "BUY" && o.status === "AWAITING_DEPOSIT" && instantPay && (
                <ActionForm
                  action={payBuyOrderAction}
                  className="mt-4 border-t border-[var(--line)] pt-4"
                  submitLabel={`Pay ${formatNgn(o.amountNgn)} now · card or transfer`}
                  resetOnSuccess={false}
                >
                  <input type="hidden" name="id" value={o.id} />
                  <p className="text-xs text-ink-soft">Confirmed instantly. Or pay by manual transfer below.</p>
                </ActionForm>
              )}
              {o.side === "BUY" && ["AWAITING_DEPOSIT", "UNDER_REVIEW"].includes(o.status) && !walletPaid(o.paymentRef) && (
                <ActionForm action={submitBuyPaymentAction} className="mt-4 border-t border-[var(--line)] pt-4">
                  <input type="hidden" name="id" value={o.id} />
                  <label className="block text-sm font-medium">
                    Bank payment reference
                    <input
                      className="input mt-1"
                      name="paymentRef"
                      defaultValue={o.paymentRef ?? ""}
                      required
                    />
                  </label>
                </ActionForm>
              )}
              {o.status === "AWAITING_DEPOSIT" && (
                <ActionForm
                  action={cancelCryptoOrderAction}
                  className="mt-2"
                  submitLabel="Cancel order (not yet funded)"
                  submitVariant="ghost"
                >
                  <input type="hidden" name="id" value={o.id} />
                </ActionForm>
              )}
              {isFailedOrderStatus(o.status) && (
                <ContactSupport reference={o.reference} status={o.status} />
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-semibold">Gift cards</h2>
        <div className="mt-3 space-y-4">
          {giftOrders.length === 0 && <p className="text-sm text-ink-soft">No gift card orders yet.</p>}
          {giftOrders.map((o) => (
            <article key={o.id} id={`order-${o.id}`} className="panel order-anchor text-sm">
              <p className="font-semibold">{o.reference}</p>
              <p className="text-ink-soft">
                {o.brand} · ${o.faceValueUsd} · {countryName(o.country)}
                <span className="mx-1.5 text-[var(--line)]">·</span>
                <span className="font-medium tabular-nums text-accent-deep">
                  {formatNgn(o.amountNgn)}
                </span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusPill status={o.status} />
                <span className="text-xs text-ink-soft">Code stored encrypted</span>
              </div>
              {o.adminNote && o.status === "REJECTED" && (
                <p className="mt-2 text-xs text-danger">Note: {o.adminNote}</p>
              )}
              {isFailedOrderStatus(o.status) && (
                <ContactSupport reference={o.reference} status={o.status} />
              )}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
