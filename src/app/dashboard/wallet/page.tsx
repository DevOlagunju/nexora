import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { cancelWithdrawalAction, requestWithdrawalAction, startWalletFundingAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { formatNgn } from "@/lib/format";
import { getWalletOverview } from "@/lib/services/wallet";
import { activeGatewayName } from "@/lib/payments/gateway";
import { paymentConfig } from "@/lib/payment-rules";
import { ActionForm } from "@/components/action-form";
import { StatusPill } from "@/components/status-pill";
import { ArrowDownLeft, ArrowUpRight, Bank, ShieldCheck } from "@/components/dashboard/icons";

export const dynamic = "force-dynamic";

const ago = (d: Date) => formatDistanceToNowStrict(d, { addSuffix: true });

export default async function WalletPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const w = await getWalletOverview(user.id);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-6">
        <section className="wallet-hero">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Naira wallet</p>
          <p className="money-private mt-2 font-[family-name:var(--font-display)] text-4xl font-bold tabular-nums sm:text-5xl">
            {formatNgn(w.balance)}
          </p>
          <p className="mt-2 text-sm text-white/70">
            {w.pendingWithdrawalNgn > 0
              ? `${formatNgn(w.pendingWithdrawalNgn)} on its way to your bank.`
              : "Sell proceeds land here the moment the desk approves them."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {activeGatewayName() && (
              <a href="#add-money" className="btn btn-primary text-sm">
                Add money
              </a>
            )}
            <Link href="/dashboard/sell-crypto" className="btn text-sm bg-white/10 text-white hover:bg-white/20">
              Sell crypto
            </Link>
            <Link href="/dashboard/sell-giftcard" className="btn text-sm bg-white/10 text-white hover:bg-white/20">
              Sell gift card
            </Link>
            <Link href="/dashboard/buy-crypto" className="btn text-sm bg-white/10 text-white hover:bg-white/20">
              Buy with balance
            </Link>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-bold text-ink">Withdrawals</h2>
          {w.withdrawals.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-[var(--line)] bg-white/60 px-5 py-6 text-sm text-ink-soft">
              No withdrawals yet.
            </p>
          ) : (
            <ul className="mt-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
              {w.withdrawals.map((x) => (
                <li key={x.id} className="ledger-row flex flex-wrap items-center gap-3 px-4 py-3.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-paper-deep text-ink">
                    <Bank />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">
                      {x.bankName} ••{x.accountLast4}
                    </span>
                    <span className="block text-xs text-[var(--muted)]">
                      {x.reference} · {ago(x.createdAt)}
                      {x.feeNgn > 0 ? ` · fee ${formatNgn(x.feeNgn)}` : ""}
                    </span>
                    {x.adminNote && (x.status === "FAILED" || x.status === "CANCELLED") && (
                      <span className="mt-0.5 block text-xs text-danger">{x.adminNote}</span>
                    )}
                  </span>
                  <span className="text-right">
                    <span className="block font-bold tabular-nums text-ink">{formatNgn(x.amountNgn)}</span>
                    <span className="mt-1 inline-block">
                      <StatusPill status={x.status} />
                    </span>
                  </span>
                  {x.status === "PENDING" && (
                    <ActionForm
                      action={cancelWithdrawalAction}
                      submitLabel="Cancel"
                      submitVariant="ghost"
                      resetOnSuccess={false}
                      className="w-full sm:w-auto [&_button]:mt-0 [&_button]:py-1.5 [&_button]:text-xs"
                    >
                      <input type="hidden" name="id" value={x.id} />
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold text-ink">Wallet history</h2>
          {w.entries.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-[var(--line)] bg-white/60 px-5 py-6 text-sm text-ink-soft">
              Nothing here yet. Choose &ldquo;Nexora wallet&rdquo; when you sell and your Naira shows up here.
            </p>
          ) : (
            <ul className="mt-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
              {w.entries.map((e) => {
                const credit = e.direction === "CREDIT";
                return (
                  <li key={e.id} className="ledger-row flex items-center gap-3 px-4 py-3">
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-full ${credit ? "bg-emerald-50 text-accent-deep" : "bg-paper-deep text-ink"}`}
                    >
                      {credit ? <ArrowDownLeft /> : <ArrowUpRight />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{e.description}</span>
                      <span className="block text-xs text-[var(--muted)]">{ago(e.createdAt)}</span>
                    </span>
                    <span className={`shrink-0 font-bold tabular-nums ${credit ? "text-accent-deep" : "text-ink"}`}>
                      {credit ? "+" : "−"}
                      {formatNgn(e.amountNgn)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-6">
        <AddMoneyPanel verified={!!w.bank} />
        <WithdrawPanel w={w} />
        <section className="card-panel text-sm text-ink-soft">
          <p className="flex items-center gap-2 font-semibold text-ink">
            <ShieldCheck /> How withdrawals work
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Paid only to your verified bank account, never to a new one.</li>
            <li>
              Minimum {formatNgn(w.config.minWithdrawalNgn)}
              {w.config.withdrawalFeeNgn > 0 ? `, ${formatNgn(w.config.withdrawalFeeNgn)} fee each` : ", no fee"}.
            </li>
            <li>Every withdrawal needs your 4-digit transaction PIN.</li>
            <li>If a bank transfer fails, the full amount comes back to your wallet automatically.</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

function AddMoneyPanel({ verified }: { verified: boolean }) {
  const gateway = activeGatewayName();
  if (!gateway) return null;
  const cfg = paymentConfig();
  if (!verified) {
    return (
      <section id="add-money" className="card-panel">
        <p className="font-semibold text-ink">Add money</p>
        <p className="mt-1 text-sm text-ink-soft">Verify your identity to fund your wallet by card or transfer.</p>
        <Link href="/dashboard/kyc" className="btn btn-dark mt-4 w-full text-sm">
          Verify identity
        </Link>
      </section>
    );
  }
  return (
    <ActionForm action={startWalletFundingAction} className="card-panel" submitLabel="Continue to secure payment" resetOnSuccess={false}>
      <p id="add-money" className="font-semibold text-ink">Add money</p>
      <p className="mt-1 text-xs text-ink-soft">
        Card (virtual cards too), bank transfer or USSD. Confirmed instantly, no waiting for the desk.
      </p>
      <label className="mt-4 block text-sm font-medium">
        Amount (₦)
        <input
          className="input mt-1 tabular-nums"
          name="amountNgn"
          type="number"
          inputMode="decimal"
          min={cfg.minFundingNgn}
          max={cfg.maxFundingNgn}
          step="1"
          required
          placeholder={`${formatNgn(cfg.minFundingNgn)} to ${formatNgn(cfg.maxFundingNgn)}`}
        />
      </label>
      {gateway === "test" && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Test mode: no real money moves.</p>
      )}
    </ActionForm>
  );
}

function WithdrawPanel({ w }: { w: Awaited<ReturnType<typeof getWalletOverview>> }) {
  if (!w.bank) {
    return (
      <section className="card-panel">
        <p className="font-semibold text-ink">Withdraw to bank</p>
        <p className="mt-1 text-sm text-ink-soft">Verify your identity and bank account to unlock withdrawals.</p>
        <Link href="/dashboard/kyc" className="btn btn-dark mt-4 w-full text-sm">
          Verify identity
        </Link>
      </section>
    );
  }
  if (!w.hasPin) {
    return (
      <section className="card-panel">
        <p className="font-semibold text-ink">Set a transaction PIN</p>
        <p className="mt-1 text-sm text-ink-soft">
          A 4-digit PIN protects your withdrawals, even if someone gets into your account.
        </p>
        <Link href="/dashboard/settings#pin" className="btn btn-dark mt-4 w-full text-sm">
          Create PIN
        </Link>
      </section>
    );
  }
  return (
    <ActionForm action={requestWithdrawalAction} className="card-panel" submitLabel="Withdraw">
      <p className="font-semibold text-ink">Withdraw to bank</p>
      <p className="mt-1 text-xs text-ink-soft">
        To {w.bank.bankName} ••{w.bank.accountLast4} · {w.bank.accountName}
      </p>
      <label className="mt-4 block text-sm font-medium">
        Amount (₦)
        <input
          className="input mt-1 tabular-nums"
          name="amountNgn"
          type="number"
          inputMode="decimal"
          min={w.config.minWithdrawalNgn}
          max={w.maxWithdrawable || undefined}
          step="0.01"
          required
          placeholder={w.maxWithdrawable > 0 ? `Up to ${formatNgn(w.maxWithdrawable)}` : "Balance too low"}
        />
      </label>
      <label className="mt-4 block text-sm font-medium">
        Transaction PIN
        <input
          className="input pin-input mt-1"
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          autoComplete="off"
          required
        />
      </label>
      {w.pinLocked && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Withdrawals are paused after too many wrong PINs. Try again later.
        </p>
      )}
      {w.config.withdrawalFeeNgn > 0 && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          A {formatNgn(w.config.withdrawalFeeNgn)} fee is taken from your wallet on top of the amount.
        </p>
      )}
    </ActionForm>
  );
}
