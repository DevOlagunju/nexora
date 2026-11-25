import { redirect } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { getSessionUser } from "@/lib/auth";
import { appBaseUrl } from "@/lib/email";
import { formatNgn } from "@/lib/format";
import { getReferralOverview } from "@/lib/services/wallet";
import { CopyButton } from "@/components/dashboard/copy-button";
import { Check, Clock } from "@/components/dashboard/icons";

export const dynamic = "force-dynamic";

export default async function ReferralsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const r = await getReferralOverview(user.id);
  const link = `${appBaseUrl()}/register?ref=${r.code}`;
  const share = encodeURIComponent(
    `I trade crypto and gift cards for Naira on Nexora. Sign up with my code ${r.code}: ${link}`,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="section-label">Rewards</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">
          Invite friends, earn {formatNgn(r.bonusNgn)}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          You get {formatNgn(r.bonusNgn)} in your wallet when someone joins with your code and completes{" "}
          {formatNgn(r.minTradeNgn)} in sells. No cap on how many friends you invite.
        </p>
      </div>

      <section className="wallet-hero">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Your code</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-wider">{r.code}</p>
          <CopyButton value={r.code} label="Copy code" />
        </div>
        <p className="mt-3 break-all text-sm text-white/70">{link}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <CopyButton value={link} label="Copy link" />
          <a
            className="btn btn-primary text-sm"
            href={`https://wa.me/?text=${share}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Share on WhatsApp
          </a>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3">
        <div className="card-panel">
          <dt className="text-xs text-[var(--muted)]">Friends joined</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">{r.referrals.length}</dd>
        </div>
        <div className="card-panel">
          <dt className="text-xs text-[var(--muted)]">Earned so far</dt>
          <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">{formatNgn(r.earnedNgn)}</dd>
        </div>
      </dl>

      <section>
        <h2 className="text-lg font-bold text-ink">Your referrals</h2>
        {r.referrals.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-[var(--line)] bg-white/60 px-5 py-6 text-sm text-ink-soft">
            No one has joined with your code yet. Share it with friends who trade.
          </p>
        ) : (
          <ul className="mt-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
            {r.referrals.map((x) => (
              <li key={x.id} className="ledger-row flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{x.name}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    Joined {formatDistanceToNowStrict(x.joinedAt, { addSuffix: true })}
                  </span>
                </span>
                {x.rewarded ? (
                  <span className="status-pill status-success inline-flex items-center gap-1">
                    <Check /> +{formatNgn(r.bonusNgn)}
                  </span>
                ) : (
                  <span className="status-pill status-pending inline-flex items-center gap-1">
                    <Clock /> Waiting for first trades
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
