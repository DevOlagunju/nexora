import { redirect } from "next/navigation";
import {
  reviewKycAction,
  updateCryptoOrderAction,
  updateGiftOrderAction,
  updateRateAction,
  updateWalletAction,
} from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { decryptSecret, maskSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/security";
import { formatNgn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  const [rates, wallets, pendingKyc, cryptoOrders, giftOrders] = await Promise.all([
    prisma.rate.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.platformWallet.findMany({ orderBy: { symbol: "asc" } }),
    prisma.kycProfile.findMany({
      where: { status: "PENDING" },
      include: { user: { select: { fullName: true, email: true, phone: true } } },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.cryptoOrder.findMany({
      where: { status: { in: ["AWAITING_DEPOSIT", "UNDER_REVIEW", "APPROVED", "PAYOUT_SENT"] } },
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.giftCardOrder.findMany({
      where: { status: { in: ["UNDER_REVIEW", "APPROVED", "PAYOUT_SENT"] } },
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">Admin desk</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Hybrid ops console — update rates, verify KYC, confirm deposits, redeem gift cards, mark
          payouts.
        </p>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Rates</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {rates.map((r) => (
              <ActionForm key={r.id} action={updateRateAction} className="card-panel">
                <input type="hidden" name="id" value={r.id} />
                <p className="font-semibold">
                  {r.displayName}{" "}
                  <span className="text-xs font-normal text-ink-soft">({r.kind})</span>
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    Sell (NGN)
                    <input
                      className="input mt-1"
                      name="sellRateNgn"
                      type="number"
                      step="any"
                      defaultValue={r.sellRateNgn}
                      required
                    />
                  </label>
                  <label className="text-sm">
                    Buy (NGN)
                    <input
                      className="input mt-1"
                      name="buyRateNgn"
                      type="number"
                      step="any"
                      defaultValue={r.buyRateNgn}
                      required
                    />
                  </label>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isActive" defaultChecked={r.isActive} />
                  Active
                </label>
              </ActionForm>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Deposit wallets</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {wallets.map((w) => (
              <ActionForm key={w.id} action={updateWalletAction} className="card-panel">
                <input type="hidden" name="symbol" value={w.symbol} />
                <p className="font-semibold">{w.symbol}</p>
                <label className="mt-3 block text-sm">
                  Network
                  <input className="input mt-1" name="network" defaultValue={w.network} required />
                </label>
                <label className="mt-3 block text-sm">
                  Address
                  <input className="input mt-1" name="address" defaultValue={w.address} required />
                </label>
              </ActionForm>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">KYC queue ({pendingKyc.length})</h2>
          <div className="mt-4 space-y-4">
            {pendingKyc.length === 0 && <p className="text-sm text-ink-soft">No pending KYC.</p>}
            {pendingKyc.map((k) => (
              <article key={k.id} className="card-panel text-sm">
                <p className="font-semibold">
                  {k.user.fullName} · {k.user.email} · {k.user.phone}
                </p>
                <p className="mt-1 text-ink-soft">
                  BVN ****{k.bvnLast4} · NIN ****{k.ninLast4} · {k.bankName} {k.accountNumber} (
                  {k.accountName})
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <ActionForm action={reviewKycAction} submitLabel="Approve KYC">
                    <input type="hidden" name="id" value={k.id} />
                    <input type="hidden" name="status" value="APPROVED" />
                    <input type="hidden" name="reviewNote" value="Approved by desk" />
                  </ActionForm>
                  <ActionForm action={reviewKycAction} submitLabel="Reject KYC">
                    <input type="hidden" name="id" value={k.id} />
                    <input type="hidden" name="status" value="REJECTED" />
                    <label className="text-sm">
                      Reject reason
                      <input className="input mt-1" name="reviewNote" required />
                    </label>
                  </ActionForm>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Crypto orders</h2>
          <div className="mt-4 space-y-4">
            {cryptoOrders.map((o) => (
              <article key={o.id} className="card-panel text-sm">
                <p className="font-semibold">
                  {o.reference} · {o.side} · {o.user.fullName}
                </p>
                <p className="text-ink-soft">
                  {o.amountCrypto} {o.symbol} @ {formatNgn(o.rateNgn)} = {formatNgn(o.amountNgn)} ·{" "}
                  {STATUS_LABEL[o.status]}
                </p>
                {o.side === "SELL" ? (
                  <p className="mt-1 break-all text-xs">
                    TX: {o.txHash ? maskSecret(o.txHash, 8) : "—"} · Pay to {o.bankName}{" "}
                    {o.accountNumber}
                  </p>
                ) : (
                  <p className="mt-1 break-all text-xs">
                    Payment ref: {o.paymentRef ?? "—"} · Send to {o.userReceiveAddress}
                    <br />
                    Expected bank pay-in: {o.bankName} {o.accountNumber}
                  </p>
                )}
                <ActionForm action={updateCryptoOrderAction} className="mt-3 grid gap-3 md:grid-cols-3">
                  <input type="hidden" name="id" value={o.id} />
                  <label>
                    Status
                    <select className="input mt-1" name="status" defaultValue={o.status}>
                      {["UNDER_REVIEW", "APPROVED", "PAYOUT_SENT", "COMPLETED", "REJECTED"].map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Payout ref
                    <input className="input mt-1" name="payoutRef" defaultValue={o.payoutRef ?? ""} />
                  </label>
                  <label>
                    Admin note
                    <input className="input mt-1" name="adminNote" defaultValue={o.adminNote ?? ""} />
                  </label>
                  {o.side === "SELL" && (
                    <label className="flex items-center gap-2 text-sm md:col-span-3">
                      <input type="checkbox" name="triggerPayout" />
                      Trigger Paystack NGN payout (sets status to PAYOUT_SENT)
                    </label>
                  )}
                </ActionForm>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Gift card orders</h2>
          <div className="mt-4 space-y-4">
            {giftOrders.map((o) => {
              let codePreview = "[decrypt failed]";
              try {
                codePreview = decryptSecret(o.cardCodeEncrypted, o.cardCodeIv);
              } catch {
                /* keep fallback */
              }
              return (
                <article key={o.id} className="card-panel text-sm">
                  <p className="font-semibold">
                    {o.reference} · {o.user.fullName}
                  </p>
                  <p className="text-ink-soft">
                    {o.brand} ${o.faceValueUsd} · {formatNgn(o.amountNgn)} · {STATUS_LABEL[o.status]}
                  </p>
                  <p className="mt-2 rounded-lg bg-paper-deep px-3 py-2 font-mono text-xs">
                    Code (admin only): {codePreview}
                  </p>
                  <p className="mt-1 text-xs text-ink-soft">
                    Pay to {o.bankName} {o.accountNumber} ({o.accountName})
                  </p>
                  <ActionForm action={updateGiftOrderAction} className="mt-3 grid gap-3 md:grid-cols-3">
                    <input type="hidden" name="id" value={o.id} />
                    <label>
                      Status
                      <select className="input mt-1" name="status" defaultValue={o.status}>
                        {["UNDER_REVIEW", "APPROVED", "PAYOUT_SENT", "COMPLETED", "REJECTED"].map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Payout ref
                      <input className="input mt-1" name="payoutRef" defaultValue={o.payoutRef ?? ""} />
                    </label>
                    <label>
                      Admin note
                      <input className="input mt-1" name="adminNote" defaultValue={o.adminNote ?? ""} />
                    </label>
                    <label className="flex items-center gap-2 text-sm md:col-span-3">
                      <input type="checkbox" name="triggerPayout" />
                      Trigger Paystack NGN payout (sets status to PAYOUT_SENT)
                    </label>
                  </ActionForm>
                </article>
              );
            })}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
