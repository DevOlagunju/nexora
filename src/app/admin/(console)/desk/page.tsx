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
  recordGiftRedemptionAction,
  resolveDepositAction,
  requestWalletAdjustmentAction,
  decideApprovalAction,
  cancelApprovalAction,
  simulateDepositAction,
} from "@/app/actions";
import { isPayoutLock } from "@/lib/payout-rules";
import { can, staffRoleLabel } from "@/lib/permissions";
import { earningsOverview } from "@/lib/services/reports";
import { listDeposits } from "@/lib/services/deposits";
import { ADJUSTMENT_REASONS, approvalLabel, approvalPermission, listApprovals } from "@/lib/services/approvals";
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

const CRYPTO_PRIORITY = ["UNDER_REVIEW", "APPROVED", "PAYOUT_SENT", "AWAITING_DEPOSIT", "COMPLETED"];
const GIFT_PRIORITY = ["UNDER_REVIEW", "APPROVED", "PAYOUT_SENT", "COMPLETED"];

function priorityIndex(status: string, order: string[]) {
  const i = order.indexOf(status);
  return i === -1 ? 99 : i;
}

export const metadata = { title: "Operations desk · Nexora admin" };

export default async function AdminDeskPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  const [approvals, earnings, deposits, rates, registry, giftRates, pendingKyc, cryptoOrdersRaw, giftOrdersRaw, withdrawals] = await Promise.all([
    // Only staff allowed to see earnings get them computed at all.
    listApprovals(),
    can(user, "reports.view") ? earningsOverview() : Promise.resolve(null),
    listDeposits(),
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
    <div className="max-w-6xl">
        <p className="section-label">Operations</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">Operations desk</h1>
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
          <a href="#approvals">Approvals{approvals.pending.length > 0 ? ` (${approvals.pending.length})` : ""}</a>
          {earnings && <a href="#earnings">Earnings</a>}
          <a href="#rates">Rates</a>
          <a href="#deposits">Deposits{deposits.exceptions.length > 0 ? ` (${deposits.exceptions.length})` : ""}</a>
          <a href="#giftcard-rates">Gift card rates</a>
          <a href="#wallets">Assets &amp; networks</a>
          <a href="#withdrawals">Withdrawals</a>
          <a href="#kyc">KYC</a>
          <a href="#crypto">Crypto</a>
          <a href="#gift">Gift cards</a>
        </nav>

        <section id="approvals" className="mb-14 scroll-mt-24">
          <p className="section-label">Approvals</p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">Changes waiting for a second person</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Deposit addresses, networks, manual wallet adjustments and staff access only take effect when a different staff
            member with the same permission approves them. Nobody can approve their own request. Requests expire after 72 hours.
          </p>
          <div className="mt-4 space-y-3">
            {approvals.pending.map((r) => {
              const mine = r.requestedById === user.id;
              const permission = approvalPermission(r.action);
              const mayDecide = !mine && !!permission && can(user, permission);
              return (
                <div key={r.id} className="panel text-sm">
                  <p className="font-semibold">{approvalLabel(r.action)}</p>
                  <p className="mt-1">{r.summary}</p>
                  {r.reason && <p className="mt-1 text-ink-soft">Reason: {r.reason}</p>}
                  <p className="mt-1 text-xs text-ink-soft">
                    Asked by {r.requestedBy.fullName} ({r.requestedBy.email}) ·{" "}
                    {r.requestedAt.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })} · expires{" "}
                    {r.expiresAt.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}
                  </p>
                  {mine ? (
                    <ActionForm action={cancelApprovalAction} className="mt-3" submitLabel="Cancel my request" submitVariant="danger" resetOnSuccess={false}>
                      <input type="hidden" name="id" value={r.id} />
                      <p className="text-xs text-ink-soft">Waiting for another staff member to approve.</p>
                    </ActionForm>
                  ) : mayDecide ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <ActionForm action={decideApprovalAction} submitLabel="Approve and apply" submitVariant="dark" resetOnSuccess={false}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="decision" value="approve" />
                        <input className="input" name="note" placeholder={r.action === "ledger.adjustment" ? "What you checked (required)" : "Note (optional)"} />
                      </ActionForm>
                      <ActionForm action={decideApprovalAction} submitLabel="Reject" submitVariant="danger" resetOnSuccess={false}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="decision" value="reject" />
                        <input className="input" name="note" placeholder="Why (optional)" />
                      </ActionForm>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-ink-soft">Your role cannot approve this kind of change.</p>
                  )}
                </div>
              );
            })}
            {approvals.pending.length === 0 && <p className="text-sm text-ink-soft">Nothing waiting.</p>}
          </div>

          {can(user, "ledger.adjust") && (
            <ActionForm action={requestWalletAdjustmentAction} className="panel mt-6" submitLabel="Request adjustment">
              <p className="font-semibold">Adjust a customer&apos;s wallet</p>
              <p className="mt-1 text-xs text-ink-soft">
                For corrections only. Posted to the ledger as an adjustment once another finance staff member approves it.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <label className="block text-sm md:col-span-2">
                  Customer email
                  <input className="input mt-1" name="email" type="email" required />
                </label>
                <label className="block text-sm">
                  Credit or debit
                  <select className="input mt-1" name="direction" defaultValue="CREDIT">
                    <option value="CREDIT">Credit (add)</option>
                    <option value="DEBIT">Debit (take)</option>
                  </select>
                </label>
                <label className="block text-sm">
                  Amount (₦)
                  <input className="input mt-1" name="amountNgn" type="number" step="0.01" min="0.01" required />
                </label>
                <label className="block text-sm md:col-span-2">
                  Reason
                  <select className="input mt-1" name="reasonCode" required defaultValue="">
                    <option value="" disabled>
                      Pick
                    </option>
                    {Object.entries(ADJUSTMENT_REASONS).map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm md:col-span-2">
                  Details (order or reference, what happened)
                  <input className="input mt-1" name="note" required minLength={10} />
                </label>
              </div>
            </ActionForm>
          )}

          {approvals.recent.length > 0 && (
            <details className="mt-6 text-sm">
              <summary className="cursor-pointer font-semibold">Recent decisions</summary>
              <ul className="mt-3 space-y-2">
                {approvals.recent.map((r) => (
                  <li key={r.id} className="panel">
                    <p>
                      <strong>{r.status}</strong> · {approvalLabel(r.action)} · {r.summary}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">
                      Asked by {r.requestedBy.fullName}
                      {r.decidedBy ? `, decided by ${r.decidedBy.fullName}` : ""}
                      {r.decisionNote ? ` · "${r.decisionNote}"` : ""}
                      {r.result ? ` · ${r.result}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {earnings && (
          <section id="earnings" className="mb-14 scroll-mt-24">
            <p className="section-label">Earnings</p>
            <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">What the desk earned</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Completed trades only. Crypto earns the spread against the market price at the time of the order; gift cards
              earn what the card was redeemed for minus what the customer was paid; fees are what the ledger booked.
              Provider costs (payment gateway, exchange, network fees) are not taken off yet.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {(
                [
                  ["Today", earnings.today],
                  ["Last 7 days", earnings.week],
                  ["Last 30 days", earnings.month],
                ] as const
              ).map(([label, r]) => (
                <div key={label} className="panel text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
                  <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold text-ink">{formatNgn(r.totalNgn)}</p>
                  <ul className="mt-3 space-y-1">
                    {r.crypto.map((l) => (
                      <li key={l.key} className="flex justify-between gap-2">
                        <span>
                          {l.key} <span className="text-ink-soft">({l.trades})</span>
                        </span>
                        <span>{formatNgn(l.earnedNgn)}</span>
                      </li>
                    ))}
                    {r.gift.map((l) => (
                      <li key={l.key} className="flex justify-between gap-2">
                        <span>
                          {l.key} gift cards <span className="text-ink-soft">({l.trades})</span>
                        </span>
                        <span>{formatNgn(l.earnedNgn)}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-2">
                      <span>Fees</span>
                      <span>{formatNgn(r.feesNgn)}</span>
                    </li>
                  </ul>
                  {r.unpriced > 0 && (
                    <p className="mt-3 text-xs text-amber-900">
                      {r.unpriced} completed trade{r.unpriced === 1 ? "" : "s"} not counted: no market price at the time, or
                      the gift card&apos;s redemption value isn&apos;t recorded yet.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

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
                    <label className="text-sm">
                      Sell spread %
                      <input
                        className="input mt-1"
                        name="sellSpreadPct"
                        type="number"
                        step="0.01"
                        min={0}
                        max={20}
                        defaultValue={r.sellSpreadPct}
                        required
                      />
                    </label>
                    <label className="text-sm">
                      Buy spread %
                      <input
                        className="input mt-1"
                        name="buySpreadPct"
                        type="number"
                        step="0.01"
                        min={0}
                        max={20}
                        defaultValue={r.buySpreadPct}
                        required
                      />
                    </label>
                    <p className="col-span-2 text-xs text-ink-soft">
                      {r.marketRateNgn
                        ? `Last synced market: ${formatNgn(r.marketRateNgn)} (${r.marketRateAt?.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}). `
                        : "Not synced from the market yet. "}
                      Sync sets sell = market − sell spread, buy = market + buy spread. No separate trading fee is charged.
                    </p>
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

        <section id="deposits" className="mt-14 scroll-mt-24">
          <p className="section-label">Deposits</p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">Crypto arriving on-chain</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Each customer sends to their own address. Once a deposit has the confirmations its network needs, it is matched
            to the customer&apos;s open sell order, which moves to Under review. Nothing is paid automatically. Anything
            unusual waits below for a person.
          </p>

          {deposits.exceptions.length > 0 && (
            <div className="mt-6 space-y-3">
              <p className="font-semibold text-amber-950">Needs a person ({deposits.exceptions.length})</p>
              {deposits.exceptions.map((d) => (
                <ActionForm key={d.id} action={resolveDepositAction} className="panel text-sm" resetOnSuccess={false} submitLabel="Mark resolved">
                  <input type="hidden" name="id" value={d.id} />
                  <p className="font-semibold">
                    {d.status.replace("_", " ")} · {d.amount} {d.symbol} on {d.network}
                    {d.order ? ` · ${d.order.reference}` : ""}
                  </p>
                  <p className="mt-1 break-all text-xs text-ink-soft">
                    To {d.toAddress} · tx {d.txHash} · {d.confirmations} confirmations
                  </p>
                  {d.note && <p className="mt-1 text-xs text-amber-900">{d.note}</p>}
                  <label className="mt-3 block text-sm">
                    What was done
                    <input className="input mt-1" name="note" placeholder="e.g. Refunded to sender, or attached to order by hand" required />
                  </label>
                </ActionForm>
              ))}
            </div>
          )}

          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-ink-soft">
                <tr>
                  <th className="py-2 pr-3">Seen</th>
                  <th className="py-2 pr-3">Amount</th>
                  <th className="py-2 pr-3">Confirmations</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Order</th>
                </tr>
              </thead>
              <tbody>
                {deposits.recent.map((d) => (
                  <tr key={d.id} className="border-t border-[var(--line)]">
                    <td className="py-2 pr-3">{d.firstSeenAt.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</td>
                    <td className="py-2 pr-3">
                      {d.amount} {d.symbol} · {d.network}
                    </td>
                    <td className="py-2 pr-3">{d.confirmations}</td>
                    <td className="py-2 pr-3">{d.status.replace("_", " ")}</td>
                    <td className="py-2 pr-3">{d.order?.reference ?? "-"}</td>
                  </tr>
                ))}
                {deposits.recent.length === 0 && (
                  <tr>
                    <td className="py-3 text-ink-soft" colSpan={5}>
                      No deposits seen yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {deposits.simulated && (
            <ActionForm action={simulateDepositAction} className="panel mt-6" submitLabel="Simulate deposit" resetOnSuccess={false}>
              <p className="font-semibold">Test a deposit (simulated provider, local only)</p>
              <p className="mt-1 text-xs text-ink-soft">
                Copy a customer&apos;s deposit address from their sell order. Send once with fewer confirmations than the
                network needs, then again with the same transaction hash and enough confirmations. Tick &quot;dropped&quot; to
                simulate the transfer leaving the chain. This form does not exist in production.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="block text-sm md:col-span-3">
                  Deposit address
                  <input className="input mt-1" name="toAddress" required />
                </label>
                <label className="block text-sm">
                  Asset
                  <input className="input mt-1" name="symbol" defaultValue="USDT" required />
                </label>
                <label className="block text-sm">
                  Network
                  <input className="input mt-1" name="network" defaultValue="TRC20" required />
                </label>
                <label className="block text-sm">
                  Amount
                  <input className="input mt-1" name="amount" type="number" step="any" required />
                </label>
                <label className="block text-sm">
                  Confirmations
                  <input className="input mt-1" name="confirmations" type="number" min={0} defaultValue={20} required />
                </label>
                <label className="block text-sm md:col-span-2">
                  Transaction hash (to update one already sent)
                  <input className="input mt-1" name="txHash" placeholder="Leave empty for a new transfer" />
                </label>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="dropped" /> Dropped from the chain
              </label>
            </ActionForm>
          )}
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
                submitLabel="Request change"
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

          <ActionForm action={addAssetNetworkAction} className="panel mt-6" submitLabel="Request new network">
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
                  {["UNDER_REVIEW", "APPROVED", "PAYOUT_SENT", "COMPLETED"].includes(o.status) && (
                    <ActionForm
                      action={recordGiftRedemptionAction}
                      className="mt-4 border-t border-[var(--line)] pt-4"
                      resetOnSuccess={false}
                      submitLabel="Save redemption"
                    >
                      <input type="hidden" name="id" value={o.id} />
                      <label className="block text-sm">
                        Redeemed or sold for (₦), for the earnings report
                        <input
                          className="input mt-1"
                          name="redeemedNgn"
                          type="number"
                          step="any"
                          min={0}
                          defaultValue={o.redeemedNgn ?? ""}
                          placeholder={`Paid customer ${formatNgn(o.amountNgn)}`}
                          required
                        />
                      </label>
                    </ActionForm>
                  )}
                </article>
              );
            })}
          </div>
        </section>
    </div>
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
