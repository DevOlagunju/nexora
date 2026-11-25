import { redirect } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { createRateAlertAction, deleteRateAlertAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { listRateAlerts } from "@/lib/services/rate-alerts";
import { ActionForm } from "@/components/action-form";
import { ChoiceCards } from "@/components/wallet/payout-choice";

export const dynamic = "force-dynamic";

export default async function RateAlertsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const [rates, alerts] = await Promise.all([
    prisma.rate.findMany({ where: { isActive: true }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
    listRateAlerts(user.id),
  ]);
  const bySymbol = new Map(rates.map((r) => [`${r.kind}:${r.symbol}`, r]));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div>
        <p className="section-label">Rate alerts</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">Sell at the right moment</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-soft">
          Set a target and we&apos;ll notify you in-app and by email the moment our desk rate reaches it. No need
          to keep refreshing.
        </p>

        <h2 className="mt-8 text-lg font-bold text-ink">Your alerts</h2>
        {alerts.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-[var(--line)] bg-white/60 px-5 py-6 text-sm text-ink-soft">
            No alerts yet. Create one on the right.
          </p>
        ) : (
          <ul className="mt-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
            {alerts.map((a) => {
              const rate = bySymbol.get(`${a.kind}:${a.symbol}`);
              const now = rate ? (a.side === "SELL" ? rate.sellRateNgn : rate.buyRateNgn) : null;
              const gap = now !== null ? ((a.targetNgn - now) / now) * 100 : null;
              return (
                <li key={a.id} className="ledger-row flex flex-wrap items-center gap-3 px-4 py-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">
                      {rate?.displayName ?? a.symbol} · {a.side === "SELL" ? "you sell" : "you buy"}{" "}
                      {a.direction === "ABOVE" ? "≥" : "≤"} {formatNgn(a.targetNgn)}
                      {a.kind === "GIFTCARD" ? "/$" : ""}
                    </span>
                    <span className="block text-xs text-[var(--muted)]">
                      {a.isActive
                        ? now !== null
                          ? `Now ${formatNgn(now)} · ${gap !== null ? `${Math.abs(gap).toFixed(1)}% to go` : ""}`
                          : "Asset paused"
                        : `Triggered ${a.triggeredAt ? formatDistanceToNowStrict(a.triggeredAt, { addSuffix: true }) : ""}`}
                    </span>
                  </span>
                  <span className={`status-pill ${a.isActive ? "status-review" : "status-success"}`}>
                    {a.isActive ? "Watching" : "Triggered"}
                  </span>
                  <ActionForm
                    action={deleteRateAlertAction}
                    submitLabel="Remove"
                    submitVariant="ghost"
                    resetOnSuccess={false}
                    className="[&_button]:mt-0 [&_button]:w-auto [&_button]:py-1.5 [&_button]:text-xs"
                  >
                    <input type="hidden" name="id" value={a.id} />
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <aside>
        <ActionForm action={createRateAlertAction} className="card-panel" submitLabel="Create alert">
          <p className="font-semibold text-ink">New alert</p>
          <label className="mt-4 block text-sm font-medium">
            Asset
            <select className="input mt-1" name="rateId" required defaultValue={rates[0]?.id}>
              {rates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.displayName} (sell {formatNgn(r.sellRateNgn)}
                  {r.kind === "GIFTCARD" ? "/$" : ""})
                </option>
              ))}
            </select>
          </label>
          <ChoiceCards
            name="side"
            legend="Rate to watch"
            defaultValue="SELL"
            options={[
              { value: "SELL", title: "When I sell", detail: "Naira you receive" },
              { value: "BUY", title: "When I buy", detail: "Crypto only" },
            ]}
          />
          <ChoiceCards
            name="direction"
            legend="Notify me when it goes"
            defaultValue="ABOVE"
            options={[
              { value: "ABOVE", title: "Above", detail: "Rate rises to target" },
              { value: "BELOW", title: "Below", detail: "Rate drops to target" },
            ]}
          />
          <label className="mt-4 block text-sm font-medium">
            Target rate (₦)
            <input className="input mt-1 tabular-nums" name="targetNgn" type="number" step="any" min="1" required />
          </label>
        </ActionForm>
      </aside>
    </div>
  );
}
