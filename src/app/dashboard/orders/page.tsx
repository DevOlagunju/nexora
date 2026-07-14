import { redirect } from "next/navigation";
import { submitBuyPaymentAction, submitCryptoTxAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/security";
import { formatNgn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

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

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">Your orders</h1>

        <section className="mt-8">
          <h2 className="font-semibold">Crypto</h2>
          <div className="mt-3 space-y-4">
            {cryptoOrders.length === 0 && <p className="text-sm text-ink-soft">No crypto orders.</p>}
            {cryptoOrders.map((o) => (
              <article key={o.id} className="card-panel text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {o.reference} · {o.side}
                    </p>
                    <p className="text-ink-soft">
                      {o.amountCrypto} {o.symbol} ({o.network}) → {formatNgn(o.amountNgn)}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">Status: {STATUS_LABEL[o.status]}</p>
                  </div>
                  {o.side === "SELL" ? (
                    <p className="max-w-xs break-all text-xs text-ink-soft">
                      Deposit: {o.depositAddress}
                    </p>
                  ) : (
                    <p className="max-w-xs break-all text-xs text-ink-soft">
                      Receive: {o.userReceiveAddress}
                      <br />
                      Pay: {o.bankName} {o.accountNumber}
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
                {o.side === "BUY" && ["AWAITING_DEPOSIT", "UNDER_REVIEW"].includes(o.status) && (
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
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-semibold">Gift cards</h2>
          <div className="mt-3 space-y-4">
            {giftOrders.length === 0 && <p className="text-sm text-ink-soft">No gift card orders.</p>}
            {giftOrders.map((o) => (
              <article key={o.id} className="card-panel text-sm">
                <p className="font-semibold">{o.reference}</p>
                <p className="text-ink-soft">
                  {o.brand} · ${o.faceValueUsd} · {o.country} → {formatNgn(o.amountNgn)}
                </p>
                <p className="mt-1 text-xs text-ink-soft">
                  Status: {STATUS_LABEL[o.status]} · Code stored encrypted
                </p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
