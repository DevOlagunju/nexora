import { redirect } from "next/navigation";
import {
  reviewKycAction,
  syncLiveCryptoRatesAction,
  updateCryptoOrderAction,
  updateGiftOrderAction,
  updateRateAction,
  updateWalletAction,
} from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { maskSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/security";
import { StatusPill } from "@/components/status-pill";
import { formatNgn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { DeskFlow } from "@/components/desk-flow";
import { RevealGiftCode } from "@/components/reveal-gift-code";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

const CRYPTO_PRIORITY = ["UNDER_REVIEW", "APPROVED", "PAYOUT_SENT", "AWAITING_DEPOSIT", "COMPLETED"];
const GIFT_PRIORITY = ["UNDER_REVIEW", "APPROVED", "PAYOUT_SENT", "COMPLETED"];

function priorityIndex(status: string, order: string[]) {
  const i = order.indexOf(status);
  return i === -1 ? 99 : i;
}

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  const [rates, wallets, pendingKyc, cryptoOrdersRaw, giftOrdersRaw] = await Promise.all([
    prisma.rate.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.platformWallet.findMany({ orderBy: { symbol: "asc" } }),
    prisma.kycProfile.findMany({
      where: { status: "PENDING" },
      include: { user: { select: { fullName: true, email: true, phone: true } } },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.cryptoOrder.findMany({
      where: {
        status: { in: ["AWAITING_DEPOSIT", "UNDER_REVIEW", "APPROVED", "PAYOUT_SENT", "COMPLETED"] },
      },
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.giftCardOrder.findMany({
      where: { status: { in: ["UNDER_REVIEW", "APPROVED", "PAYOUT_SENT", "COMPLETED"] } },
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const cryptoOrders = [...cryptoOrdersRaw].sort(
    (a, b) => priorityIndex(a.status, CRYPTO_PRIORITY) - priorityIndex(b.status, CRYPTO_PRIORITY),
  );
  const giftOrders = [...giftOrdersRaw].sort(
    (a, b) => priorityIndex(a.status, GIFT_PRIORITY) - priorityIndex(b.status, GIFT_PRIORITY),
  );

  const cryptoNeedsAction = cryptoOrdersRaw.filter((o) =>
    ["UNDER_REVIEW", "APPROVED", "PAYOUT_SENT"].includes(o.status),
  ).length;
  const giftNeedsAction = giftOrdersRaw.filter((o) =>
    ["UNDER_REVIEW", "APPROVED", "PAYOUT_SENT"].includes(o.status),
  ).length;
  const giftFraud = giftOrdersRaw.filter((o) => o.fraudFlag).length;

  return (
    <>
      <SiteHeader user={user} />
      <main className="page-shell max-w-6xl py-8">
        <p className="section-label">Operations</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">Admin desk</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">
          Work the queue in order. Keep rates current, then clear KYC and payouts.
        </p>
        <DeskFlow
          title="Daily desk flow"
          steps={[
            { label: "Set rates", hint: "Keep desk book current" },
            { label: "Clear KYC", hint: "Approve verified users" },
            { label: "Confirm asset", hint: "Bank, TX, or card" },
            { label: "Payout", hint: "Paystack or manual ref" },
            { label: "Completed", hint: "Mark order done" },
          ]}
        />

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <a href="#kyc" className="panel block transition hover:border-accent">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">KYC queue</p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">
              {pendingKyc.length}
            </p>
          </a>
          <a href="#crypto" className="panel block transition hover:border-accent">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Crypto action</p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">
              {cryptoNeedsAction}
            </p>
          </a>
          <a href="#gift" className="panel block transition hover:border-accent">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Gift action</p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">
              {giftNeedsAction}
            </p>
          </a>
          <a href="#gift" className="panel block transition hover:border-accent">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Fraud flags</p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold text-danger">
              {giftFraud}
            </p>
          </a>
        </div>

        <nav className="dash-nav mt-8" aria-label="Admin sections">
          <a href="#rates">Rates</a>
          <a href="#wallets">Wallets</a>
          <a href="#kyc">KYC</a>
          <a href="#crypto">Crypto</a>
          <a href="#gift">Gift cards</a>
        </nav>

        <section id="rates" className="scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="section-label">Rates</p>
              <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">Desk rates</h2>
              <p className="mt-1 text-sm text-ink-soft">
                These lock into trades. Sync pulls live crypto mids without guessing gift cards.
              </p>
            </div>
            <ActionForm
              action={syncLiveCryptoRatesAction}
              className="shrink-0 min-w-[12rem]"
              resetOnSuccess={false}
              submitLabel="Sync live crypto"
              submitVariant="dark"
            >
              <span className="sr-only">Sync desk crypto rates from live benchmarks</span>
            </ActionForm>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {rates.map((r) => (
              <ActionForm
                key={r.id}
                action={updateRateAction}
                className="panel flex flex-col"
                resetOnSuccess={false}
                submitLabel="Save rate"
              >
                <input type="hidden" name="id" value={r.id} />
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">
                    {r.displayName}{" "}
                    <span className="text-xs font-normal text-ink-soft">({r.kind})</span>
                  </p>
                  {!r.isActive && <span className="status-pill status-muted">Inactive</span>}
                </div>
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
                  <input type="checkbox" name="isActive" value="true" defaultChecked={r.isActive} />
                  Active
                </label>
              </ActionForm>
            ))}
          </div>
        </section>

        <section id="wallets" className="mt-14 scroll-mt-24">
          <p className="section-label">Wallets</p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">
            Deposit wallets
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Allowlist notes show to customers on sell-crypto - use them for network rules.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {wallets.map((w) => (
              <ActionForm
                key={w.id}
                action={updateWalletAction}
                className="panel"
                resetOnSuccess={false}
                submitLabel="Save wallet"
              >
                <input type="hidden" name="symbol" value={w.symbol} />
                <p className="font-semibold">
                  {w.symbol}
                  <span className="ml-2 text-xs font-normal text-ink-soft">{w.network}</span>
                </p>
                <label className="mt-3 block text-sm">
                  Network
                  <input className="input mt-1" name="network" defaultValue={w.network} required />
                </label>
                <label className="mt-3 block text-sm">
                  Address
                  <input className="input mt-1" name="address" defaultValue={w.address} required />
                </label>
                <label className="mt-3 block text-sm">
                  Allowlist / ops note
                  <input
                    className="input mt-1"
                    name="note"
                    defaultValue={w.note ?? ""}
                    placeholder="e.g. TRC20 only - verify before confirming"
                  />
                </label>
              </ActionForm>
            ))}
            {wallets.length === 0 && (
              <p className="text-sm text-ink-soft">No wallets configured. Seed or add via Prisma.</p>
            )}
          </div>
        </section>

        <section id="kyc" className="mt-14 scroll-mt-24">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="section-label">KYC</p>
              <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">
                Identity queue
              </h2>
            </div>
            <StatusPill status="PENDING" />
            <span className="text-sm text-ink-soft">{pendingKyc.length} waiting</span>
          </div>
          <div className="mt-6 space-y-4">
            {pendingKyc.length === 0 && (
              <p className="ops-hint">No pending KYC. Queue is clear.</p>
            )}
            {pendingKyc.map((k) => (
              <article key={k.id} className="panel text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{k.user.fullName}</p>
                    <p className="mt-1 text-ink-soft">
                      {k.user.email} · {k.user.phone}
                    </p>
                  </div>
                  <StatusPill status="PENDING" />
                </div>
                <div className="ops-hint mt-4">
                  BVN ****{k.bvnLast4} · NIN ****{k.ninLast4}
                  <br />
                  {k.bankName} {k.accountNumber} ({k.accountName})
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <ActionForm action={reviewKycAction} submitLabel="Approve KYC">
                    <input type="hidden" name="id" value={k.id} />
                    <input type="hidden" name="status" value="APPROVED" />
                    <input type="hidden" name="reviewNote" value="Approved by desk" />
                  </ActionForm>
                  <ActionForm action={reviewKycAction} submitLabel="Reject KYC" submitVariant="danger">
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

        <section id="crypto" className="mt-14 scroll-mt-24">
          <p className="section-label">Crypto</p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">
            Crypto orders
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Actionable statuses are sorted first. Close each ticket through payout.
          </p>
          <DeskFlow
            title="Crypto order flow"
            steps={[
              { label: "Review", hint: "Check payment or TX hash" },
              { label: "Approve", hint: "Confirm amount and user" },
              { label: "Payout", hint: "Send NGN or crypto" },
              { label: "Completed", hint: "Mark order done" },
            ]}
          />
          <div className="mt-6 space-y-4">
            {cryptoOrders.length === 0 && (
              <p className="ops-hint">No crypto orders in the active desk window.</p>
            )}
            {cryptoOrders.map((o) => (
              <article key={o.id} className="panel text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">
                      {o.reference} · {o.side}
                    </p>
                    <p className="mt-1 text-ink-soft">
                      {o.user.fullName} · {o.user.email}
                    </p>
                    <p className="mt-2">
                      {o.amountCrypto} {o.symbol} @ {formatNgn(o.rateNgn)} ={" "}
                      <strong>{formatNgn(o.amountNgn)}</strong>
                    </p>
                  </div>
                  <StatusPill status={o.status} />
                </div>

                {o.side === "SELL" ? (
                  <div className="ops-hint mt-4 break-all">
                    TX: {o.txHash ? maskSecret(o.txHash, 8) : "N/A"}
                    <br />
                    Pay to {o.bankName} {o.accountNumber}
                    {o.depositAddress ? (
                      <>
                        <br />
                        Deposit: {o.depositAddress}
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="ops-hint mt-4 break-all">
                    Payment ref: {o.paymentRef ?? "N/A"}
                    <br />
                    Send crypto to {o.userReceiveAddress}
                    <br />
                    Expected NGN in: {o.bankName} {o.accountNumber}
                  </div>
                )}

                <ActionForm
                  action={updateCryptoOrderAction}
                  className="mt-4 border-t border-[var(--line)] pt-4"
                  resetOnSuccess={false}
                  submitLabel="Save order"
                >
                  <input type="hidden" name="id" value={o.id} />
                  <div className="grid gap-3 md:grid-cols-3">
                    <label>
                      Status
                      <select className="input mt-1" name="status" defaultValue={o.status}>
                        {[
                          "AWAITING_DEPOSIT",
                          "UNDER_REVIEW",
                          "APPROVED",
                          "PAYOUT_SENT",
                          "COMPLETED",
                          "REJECTED",
                        ].map((s) => (
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
                  </div>
                  {o.side === "SELL" && (
                    <label className="mt-3 flex items-center gap-2 text-sm">
                      <input type="checkbox" name="triggerPayout" value="true" />
                      Trigger Paystack NGN payout (sets PAYOUT_SENT)
                    </label>
                  )}
                </ActionForm>
              </article>
            ))}
          </div>
        </section>

        <section id="gift" className="mt-14 scroll-mt-24 pb-8">
          <p className="section-label">Gift cards</p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">
            Gift card orders
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Reveal codes only when you are ready to redeem. Fraud-flagged tickets need offsite checks.
          </p>
          <DeskFlow
            title="Gift card flow"
            steps={[
              { label: "Reveal code", hint: "Decrypt on demand (logged)" },
              { label: "Verify offsite", hint: "Extra check if flagged" },
              { label: "Payout", hint: "Send NGN to user bank" },
              { label: "Completed", hint: "Mark order done" },
            ]}
          />
          <div className="mt-6 space-y-4">
            {giftOrders.length === 0 && (
              <p className="ops-hint">No gift card orders in the active desk window.</p>
            )}
            {giftOrders.map((o) => {
              return (
                <article key={o.id} className="panel text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{o.reference}</p>
                      <p className="mt-1 text-ink-soft">
                        {o.user.fullName} · {o.user.email}
                      </p>
                      <p className="mt-2">
                        {o.brand} ${o.faceValueUsd} · <strong>{formatNgn(o.amountNgn)}</strong>
                      </p>
                    </div>
                    <StatusPill status={o.status} />
                  </div>

                  {o.fraudFlag && (
                    <p className="ops-hint mt-4 text-amber-950">
                      Fraud flag: {o.fraudNote ?? "Review carefully before payout"}
                    </p>
                  )}

                  <RevealGiftCode orderId={o.id} reference={o.reference} />
                  <p className="mt-2 text-xs text-ink-soft">
                    Pay to {o.bankName} {o.accountNumber} ({o.accountName})
                  </p>

                  <ActionForm
                    action={updateGiftOrderAction}
                    className="mt-4 border-t border-[var(--line)] pt-4"
                    resetOnSuccess={false}
                    submitLabel="Save order"
                  >
                    <input type="hidden" name="id" value={o.id} />
                    <div className="grid gap-3 md:grid-cols-3">
                      <label>
                        Status
                        <select className="input mt-1" name="status" defaultValue={o.status}>
                          {["UNDER_REVIEW", "APPROVED", "PAYOUT_SENT", "COMPLETED", "REJECTED"].map(
                            (s) => (
                              <option key={s} value={s}>
                                {STATUS_LABEL[s]}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        Payout ref
                        <input
                          className="input mt-1"
                          name="payoutRef"
                          defaultValue={o.payoutRef ?? ""}
                        />
                      </label>
                      <label>
                        Admin note
                        <input
                          className="input mt-1"
                          name="adminNote"
                          defaultValue={o.adminNote ?? ""}
                        />
                      </label>
                    </div>
                    <label className="mt-3 flex items-center gap-2 text-sm">
                      <input type="checkbox" name="triggerPayout" value="true" />
                      Trigger Paystack NGN payout (sets PAYOUT_SENT)
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
