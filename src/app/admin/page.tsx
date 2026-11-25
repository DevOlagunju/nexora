import { redirect } from "next/navigation";
import {
  reviewKycAction,
  syncLiveCryptoRatesAction,
  updateCryptoOrderAction,
  updateGiftOrderAction,
  updateRateAction,
  updateAssetNetworkAction,
  processWithdrawalAction,
  verifyOrderPayoutAction,
  addAssetNetworkAction,
  updateGiftCardRateAction,
  addGiftCardRateAction,
} from "@/app/actions";
import { isPayoutLock } from "@/lib/payout-rules";
import { staffRoleLabel } from "@/lib/permissions";
import { adminRegistry } from "@/lib/services/assets";
import { explorerTxLink } from "@/lib/asset-rules";
import { adminGiftCardRates } from "@/lib/services/giftcards";
import { CARD_TYPE_LABEL, countryName } from "@/lib/giftcard-rules";
import { getSessionUser } from "@/lib/auth";
import { maskSecret } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { STATUS_LABEL, allowedNextStatuses } from "@/lib/order-status";
import { StatusPill } from "@/components/status-pill";
import { formatNgn } from "@/lib/format";
import { sumNgn } from "@/lib/money";
import { paystackConfigured } from "@/lib/paystack";
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

  const [rates, registry, giftRates, pendingKyc, cryptoOrdersRaw, giftOrdersRaw, withdrawals] = await Promise.all([
    prisma.rate.findMany({ orderBy: { sortOrder: "asc" } }),
    adminRegistry(),
    adminGiftCardRates(),
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
    prisma.withdrawal.findMany({
      where: { status: { in: ["PENDING", "PROCESSING"] } },
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
  ]);
  const withdrawalTotal = sumNgn(withdrawals.map((w) => w.amountNgn));
  const canPaystack = paystackConfigured();
  const explorerByNetwork = new Map(registry.networks.map((n) => [n.code, n.explorerTxUrl]));

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
          Work the queue in order. Keep rates current, then clear KYC and payouts. You are signed in as{" "}
          <strong>{staffRoleLabel(user)}</strong>; actions outside that role are refused and logged.
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

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <a href="#withdrawals" className="panel block transition hover:border-accent">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Withdrawals</p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">
              {withdrawals.length}
            </p>
            {withdrawals.length > 0 && <p className="text-xs text-ink-soft">{formatNgn(withdrawalTotal)} owed</p>}
          </a>
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
          <a href="#giftcard-rates">Gift card rates</a>
          <a href="#wallets">Assets &amp; networks</a>
          <a href="#withdrawals">Withdrawals</a>
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
                {r.kind === "GIFTCARD" ? (
                  <p className="mt-3 text-sm text-ink-soft">
                    Default variant pays <strong className="text-ink">{formatNgn(r.sellRateNgn)}</strong> per $1. Prices
                    are set per country and card type under <a className="underline" href="#giftcard-rates">Gift card rates</a>.
                  </p>
                ) : (
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
                )}
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isActive" value="true" defaultChecked={r.isActive} />
                  Active
                </label>
              </ActionForm>
            ))}
          </div>
        </section>

        <section id="giftcard-rates" className="mt-14 scroll-mt-24">
          <p className="section-label">Gift card rates</p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">
            Price by country and card type
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Naira per $1 of face value. Each brand has one <strong>default</strong>: it is used when a customer does not
            say where the card is from or its type, and it is the rate shown on the rates page and in the app. Leave
            accepted values empty to take any amount between the minimum and maximum. Every change is logged with the old
            and new price.
          </p>
          {giftRates.brands.map((b) => {
            const variants = giftRates.variants.filter((v) => v.brand === b.symbol);
            return (
              <div key={b.symbol} className="mt-6">
                <p className="font-semibold">
                  {b.displayName}
                  {!b.isActive && <span className="status-pill status-muted ml-2">Brand off</span>}
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {variants.map((v) => (
                    <ActionForm key={v.id} action={updateGiftCardRateAction} className="panel" resetOnSuccess={false} submitLabel="Save">
                      <input type="hidden" name="id" value={v.id} />
                      <p className="text-sm font-semibold">
                        {countryName(v.country)} · {CARD_TYPE_LABEL[v.cardType]}
                        {v.isDefault && <span className="ml-2 text-xs font-normal text-ink-soft">default</span>}
                        {!v.isActive && <span className="status-pill status-muted ml-2">Off</span>}
                      </p>
                      <div className="mt-3 grid grid-cols-3 gap-3">
                        <label className="block text-sm">
                          ₦ per $1
                          <input className="input mt-1" name="rateNgn" type="number" step="any" defaultValue={v.rateNgn} required />
                        </label>
                        <label className="block text-sm">
                          Min $
                          <input className="input mt-1" name="minFaceUsd" type="number" step="any" defaultValue={v.minFaceUsd} required />
                        </label>
                        <label className="block text-sm">
                          Max $
                          <input className="input mt-1" name="maxFaceUsd" type="number" step="any" defaultValue={v.maxFaceUsd ?? ""} />
                        </label>
                      </div>
                      <label className="mt-3 block text-sm">
                        Accepted values ($)
                        <input className="input mt-1" name="denominations" defaultValue={v.denominations ?? ""} placeholder="Any, or e.g. 25, 50, 100" />
                      </label>
                      <div className="mt-3 flex flex-wrap gap-4 text-sm">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" name="isActive" defaultChecked={v.isActive} /> On
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" name="isDefault" defaultChecked={v.isDefault} /> Default
                        </label>
                      </div>
                    </ActionForm>
                  ))}
                </div>
              </div>
            );
          })}

          <ActionForm action={addGiftCardRateAction} className="panel mt-6" submitLabel="Add">
            <p className="font-semibold">Add a country or card type</p>
            <p className="mt-1 text-xs text-ink-soft">It starts switched off, unless it is the brand&apos;s first.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="block text-sm">
                Brand
                <select className="input mt-1" name="brand" required defaultValue="">
                  <option value="" disabled>
                    Pick
                  </option>
                  {giftRates.brands.map((b) => (
                    <option key={b.symbol} value={b.symbol}>
                      {b.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Country
                <input className="input mt-1" name="country" placeholder="e.g. AU or Australia" required />
              </label>
              <label className="block text-sm">
                Card type
                <select className="input mt-1" name="cardType" required defaultValue="ECODE">
                  <option value="ECODE">E-code</option>
                  <option value="PHYSICAL">Physical card</option>
                </select>
              </label>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <label className="block text-sm">
                ₦ per $1
                <input className="input mt-1" name="rateNgn" type="number" step="any" required />
              </label>
              <label className="block text-sm">
                Min $
                <input className="input mt-1" name="minFaceUsd" type="number" step="any" required />
              </label>
              <label className="block text-sm">
                Max $
                <input className="input mt-1" name="maxFaceUsd" type="number" step="any" />
              </label>
              <label className="block text-sm">
                Accepted values
                <input className="input mt-1" name="denominations" placeholder="Optional" />
              </label>
            </div>
          </ActionForm>
        </section>

        <section id="wallets" className="mt-14 scroll-mt-24">
          <p className="section-label">Assets and networks</p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">
            Where each asset moves
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            One card per asset per network. <strong>Sell</strong> lets customers send the asset to the deposit address;{" "}
            <strong>Buy</strong> lets the desk send it out on that network. The note shows to customers next to the
            address. Address changes are checked against the network&apos;s format, logged and alerted.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {registry.assetNetworks.map((a) => (
              <ActionForm
                key={a.id}
                action={updateAssetNetworkAction}
                className="panel"
                resetOnSuccess={false}
                submitLabel="Save"
              >
                <input type="hidden" name="id" value={a.id} />
                <p className="font-semibold">
                  {a.symbol}
                  <span className="ml-2 text-xs font-normal text-ink-soft">
                    {a.network.name}
                    {!a.network.isActive && " · network switched off"}
                  </span>
                </p>
                <label className="mt-3 block text-sm">
                  Deposit address
                  <input className="input mt-1" name="depositAddress" defaultValue={a.depositAddress} required />
                </label>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    Memo / tag
                    <input className="input mt-1" name="depositMemo" defaultValue={a.depositMemo ?? ""} placeholder="Only if needed" />
                  </label>
                  <label className="block text-sm">
                    Confirmations
                    <input className="input mt-1" name="confirmations" type="number" min={1} defaultValue={a.confirmations} required />
                  </label>
                </div>
                <label className="mt-3 block text-sm">
                  Note for customers
                  <input className="input mt-1" name="note" defaultValue={a.note ?? ""} placeholder={`e.g. ${a.network.code} only`} />
                </label>
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="depositsEnabled" defaultChecked={a.depositsEnabled} /> Sell
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="withdrawalsEnabled" defaultChecked={a.withdrawalsEnabled} /> Buy
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="isDefault" defaultChecked={a.isDefault} /> Default network
                  </label>
                </div>
              </ActionForm>
            ))}
            {registry.assetNetworks.length === 0 && (
              <p className="text-sm text-ink-soft">No asset is on any network yet. Add one below.</p>
            )}
          </div>

          <ActionForm action={addAssetNetworkAction} className="panel mt-6" submitLabel="Add network">
            <p className="font-semibold">Add an asset on another network</p>
            <p className="mt-1 text-xs text-ink-soft">
              It starts switched off. Check custody, liquidity and the address, then enable Sell or Buy.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="block text-sm">
                Asset
                <select className="input mt-1" name="symbol" required defaultValue="">
                  <option value="" disabled>
                    Pick
                  </option>
                  {registry.cryptoRates.map((r) => (
                    <option key={r.symbol} value={r.symbol}>
                      {r.symbol} · {r.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Network
                <select className="input mt-1" name="networkId" required defaultValue="">
                  <option value="" disabled>
                    Pick
                  </option>
                  {registry.networks
                    .filter((n) => n.isActive)
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block text-sm">
                Deposit address
                <input className="input mt-1" name="depositAddress" required />
              </label>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="block text-sm">
                Memo / tag
                <input className="input mt-1" name="depositMemo" placeholder="Only if the network needs one" />
              </label>
              <label className="block text-sm">
                Note for customers
                <input className="input mt-1" name="note" />
              </label>
            </div>
          </ActionForm>
        </section>

        <section id="withdrawals" className="mt-14 scroll-mt-24">
          <p className="section-label">Wallet</p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">Withdrawal queue</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Oldest first. Paid only to the customer&apos;s KYC bank account. Rejecting refunds the full amount and
            fee to their wallet.
          </p>
          {withdrawals.length === 0 ? (
            <p className="ops-hint mt-4">No withdrawals waiting.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {withdrawals.map((w) => (
                <article key={w.id} className="panel text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">
                        {formatNgn(w.amountNgn)} · {w.user.fullName}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {w.reference} · {w.user.email} ·{" "}
                        {w.createdAt.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}
                      </p>
                    </div>
                    <StatusPill status={w.status} />
                  </div>
                  <div className="ops-hint mt-3 break-all">
                    Pay {formatNgn(w.amountNgn)} to {w.accountName} · {w.bankName} · {w.accountNumber}
                    {w.payoutRef && !isPayoutLock(w.payoutRef) ? <> · transfer {w.payoutRef}</> : null}
                  </div>
                  {w.status === "PROCESSING" && isPayoutLock(w.payoutRef) && (
                    <p className="ops-hint mt-3 text-amber-950">
                      Paystack has not confirmed this transfer. Verify it before paying by hand, or the customer
                      could be paid twice.
                    </p>
                  )}
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    {w.status === "PROCESSING" && canPaystack && (
                      <ActionForm
                        action={processWithdrawalAction}
                        submitLabel="Verify with Paystack"
                        resetOnSuccess={false}
                      >
                        <input type="hidden" name="id" value={w.id} />
                        <input type="hidden" name="action" value="verify" />
                      </ActionForm>
                    )}
                    {w.status === "PENDING" && canPaystack && (
                      <ActionForm action={processWithdrawalAction} submitLabel="Pay via Paystack" resetOnSuccess={false}>
                        <input type="hidden" name="id" value={w.id} />
                        <input type="hidden" name="action" value="paystack" />
                      </ActionForm>
                    )}
                    <ActionForm
                      action={processWithdrawalAction}
                      submitLabel="Mark paid"
                      submitVariant="dark"
                      resetOnSuccess={false}
                    >
                      <input type="hidden" name="id" value={w.id} />
                      <input type="hidden" name="action" value="mark-paid" />
                      <input className="input" name="payoutRef" placeholder="Bank transfer ref" required />
                    </ActionForm>
                    {w.status === "PENDING" && (
                      <ActionForm
                        action={processWithdrawalAction}
                        submitLabel="Reject and refund"
                        submitVariant="danger"
                        resetOnSuccess={false}
                      >
                        <input type="hidden" name="id" value={w.id} />
                        <input type="hidden" name="action" value="reject" />
                        <input className="input" name="note" placeholder="Reason shown to customer" required />
                      </ActionForm>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
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
                  <br />
                  {k.accountVerified ? (
                    <span className="font-semibold text-accent-deep">✓ Account name confirmed by the bank</span>
                  ) : (
                    <span className="text-ink-soft">Account name typed by the customer (not bank-verified)</span>
                  )}
                  {k.nameMatch === true && <span className="text-accent-deep"> · matches their Nexora name</span>}
                  {k.nameMatch === false && (
                    <span className="font-semibold text-danger"> · ⚠ name differs from their Nexora name, check before approving</span>
                  )}
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
                    TX ({o.network}): {o.txHash ? maskSecret(o.txHash, 8) : "N/A"}
                    {(() => {
                      const link = explorerTxLink(explorerByNetwork.get(o.network), o.txHash);
                      return link ? (
                        <>
                          {" "}
                          <a className="underline" href={link} target="_blank" rel="noopener noreferrer">
                            Check on explorer
                          </a>
                        </>
                      ) : null;
                    })()}
                    <br />
                    {o.payoutMethod === "WALLET"
                      ? "Payout: Nexora wallet (credited when you set Completed)"
                      : `Pay to ${o.bankName} ${o.accountNumber}`}
                    {o.depositAddress ? (
                      <>
                        <br />
                        Deposit: {o.depositAddress}
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="ops-hint mt-4 break-all">
                    {o.paymentRef?.startsWith("wallet:")
                      ? "Paid from Nexora wallet (funds already debited)"
                      : `Payment ref: ${o.paymentRef ?? "N/A"}`}
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
                        {allowedNextStatuses(o.status).map((s) => (
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
                  <PayoutHint side={o.side} method={o.payoutMethod} status={o.status} />
                </ActionForm>
                <VerifyPayout channel="crypto" id={o.id} status={o.status} payoutRef={o.payoutRef} enabled={canPaystack} />
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
                        {o.brand} ${o.faceValueUsd} · {countryName(o.country)}
                        {o.cardType ? ` · ${CARD_TYPE_LABEL[o.cardType]}` : ""} · <strong>{formatNgn(o.amountNgn)}</strong>
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
                          {allowedNextStatuses(o.status)
                            .filter((s) => s !== "AWAITING_DEPOSIT")
                            .map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABEL[s]}
                              </option>
                            ))}
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
                    <PayoutHint side="SELL" method={o.payoutMethod} status={o.status} />
                  </ActionForm>
                  <VerifyPayout channel="gift" id={o.id} status={o.status} payoutRef={o.payoutRef} enabled={canPaystack} />
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

/** Shown while a Paystack payout is unconfirmed (lock held) or waiting on its webhook (Payout sent). */
function VerifyPayout({
  channel,
  id,
  status,
  payoutRef,
  enabled,
}: {
  channel: "crypto" | "gift";
  id: string;
  status: string;
  payoutRef: string | null;
  enabled: boolean;
}) {
  const locked = isPayoutLock(payoutRef);
  if (!enabled || (!locked && !(status === "PAYOUT_SENT" && payoutRef?.startsWith("TRF_")))) return null;
  return (
    <div className="mt-4 border-t border-[var(--line)] pt-4">
      {locked && (
        <p className="ops-hint mb-3 text-amber-950">
          Paystack has not confirmed this payout. Verify it before paying by hand, or the customer could be paid
          twice. The order cannot be changed until it is verified.
        </p>
      )}
      <ActionForm action={verifyOrderPayoutAction} submitLabel="Verify payout with Paystack" resetOnSuccess={false}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="channel" value={channel} />
      </ActionForm>
    </div>
  );
}

/** Payout control for a desk row: Paystack checkbox only for bank payouts that are still payable. */
function PayoutHint({ side, method, status }: { side: string; method: string; status: string }) {
  if (side !== "SELL" || !["UNDER_REVIEW", "APPROVED"].includes(status)) return null;
  if (method === "WALLET") {
    return (
      <p className="mt-3 text-xs text-ink-soft">
        Wallet payout: choose <strong>Completed</strong> to credit the customer&apos;s Nexora wallet instantly.
      </p>
    );
  }
  return (
    <label className="mt-3 flex items-center gap-2 text-sm">
      <input type="checkbox" name="triggerPayout" value="true" />
      Trigger Paystack NGN payout (sets PAYOUT_SENT)
    </label>
  );
}
