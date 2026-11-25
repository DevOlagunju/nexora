import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { getSessionUser } from "@/lib/auth";
import {
  loadDashboard,
  type ActivityItem,
  type DashboardData,
} from "@/lib/dashboard";
import { formatClockTime, formatNgn, formatNgnCompact } from "@/lib/format";
import { formatDuration } from "@/lib/alert-rules";
import { isFailedOrderStatus } from "@/lib/support";
import { StatusPill } from "@/components/status-pill";
import { QuickPayout } from "@/components/quick-payout";
import { CopyButton } from "@/components/dashboard/copy-button";
import { OrderTracker } from "@/components/dashboard/order-tracker";
import { LimitMeters } from "@/components/dashboard/limit-meters";
import { BalanceToggle } from "@/components/dashboard/balance-toggle";
import {
  Alert,
  ArrowDownLeft,
  ArrowUpRight,
  Bank,
  Chat,
  Check,
  Clock,
  GiftIcon,
  ShieldCheck,
  Bell,
  Users,
  Wallet,
} from "@/components/dashboard/icons";

export const dynamic = "force-dynamic";

function lagosGreeting(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Africa/Lagos",
    }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const ago = (d: Date) => formatDistanceToNowStrict(d, { addSuffix: true });
const orderHref = (id: string) => `/dashboard/orders#order-${id}`;

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const data = await loadDashboard(user.id);
  const firstName = user.fullName.split(" ")[0];
  const kycStatus = data.kyc?.status ?? "UNVERIFIED";
  const verified = kycStatus === "APPROVED";

  return (
    <div className="space-y-8">
      <Hero
        greeting={lagosGreeting()}
        firstName={firstName}
        email={user.email}
        kycStatus={kycStatus}
        stats={data.stats}
        canTrade={verified}
      />

      {!verified && (
        <Onboarding
          status={kycStatus}
          reviewNote={data.kyc?.reviewNote ?? null}
        />
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-8">
          {data.actions.length > 0 && <NeedsAttention actions={data.actions} />}
          {data.activeOrders.length > 0 && (
            <InProgress orders={data.activeOrders} />
          )}
          <RecentActivity items={data.activity} kycStatus={kycStatus} />
        </div>

        <aside className="space-y-5">
          <DeskRates rates={data.rates} />
          <DeskSpeed speed={data.deskSpeed} />
          {data.rates.all.length > 0 && (
            <QuickPayout
              options={data.rates.all.map((r) => ({
                symbol: r.symbol,
                displayName: r.displayName,
                sellRateNgn: r.sellRateNgn,
                kind: r.kind,
              }))}
              ctaHref={verified ? "/dashboard/sell-crypto" : "/dashboard/kyc"}
            />
          )}
          <PayoutAccount kyc={data.kyc} />
          <section className="card-panel">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold text-ink">Today&apos;s limits</h2>
              <span className="text-xs text-[var(--muted)]">
                Resets midnight WAT
              </span>
            </div>
            <div className="mt-4">
              <LimitMeters usage={data.usage} />
            </div>
          </section>
          {data.supportUrl && (
            <a
              href={data.supportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="card-panel flex items-center gap-3 transition hover:border-accent"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-accent-deep">
                <Chat className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-ink">Need help?</span>
                <span className="block text-sm text-ink-soft">
                  Chat with the desk on WhatsApp
                </span>
              </span>
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}

/* --------------------------------- hero ---------------------------------- */

function KycBadge({ status }: { status: string }) {
  if (status === "APPROVED") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/20 px-2.5 py-1 text-xs font-bold text-accent">
        <ShieldCheck className="h-3.5 w-3.5" /> Verified
      </span>
    );
  }
  const label =
    status === "PENDING"
      ? "Verification in review"
      : status === "REJECTED"
        ? "Verification failed"
        : "Not verified";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/20 px-2.5 py-1 text-xs font-bold text-gold">
      <Clock className="h-3.5 w-3.5" /> {label}
    </span>
  );
}

function Hero({
  greeting,
  firstName,
  email,
  kycStatus,
  stats,
  canTrade,
}: {
  greeting: string;
  firstName: string;
  email: string;
  kycStatus: string;
  stats: DashboardData["stats"];
  canTrade: boolean;
}) {
  const tiles = [
    {
      label: "Wallet balance",
      short: "Wallet",
      value: formatNgnCompact(stats.walletNgn),
      full: formatNgn(stats.walletNgn),
      hint: stats.walletNgn > 0 ? "Tap to withdraw" : "Sell to fund it",
      href: "/dashboard/wallet",
    },
    {
      label: "Total paid out",
      short: "Paid out",
      value: formatNgnCompact(stats.paidOutNgn),
      full: formatNgn(stats.paidOutNgn),
      hint: `${stats.completedCount} completed trade${stats.completedCount === 1 ? "" : "s"}`,
    },
    {
      label: "In progress",
      short: "In progress",
      value: formatNgnCompact(stats.inProgressNgn),
      full: formatNgn(stats.inProgressNgn),
      hint: `${stats.inProgressCount} open order${stats.inProgressCount === 1 ? "" : "s"}`,
    },
  ] as Array<{
    label: string;
    short: string;
    value: string;
    full: string;
    hint: string;
    href?: string;
  }>;

  return (
    <section className="hero-grid animate-rise relative overflow-hidden rounded-[1.75rem] text-white">
      <div className="hero-orb hero-orb--a" aria-hidden />
      <div className="hero-orb hero-orb--b" aria-hidden />
      <div className="relative grid gap-8 p-6 md:p-8 lg:grid-cols-[1fr_1.1fr] lg:items-end">
        <div>
          <p className="text-sm text-white/60">{greeting},</p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight md:text-5xl">
            {firstName}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/55">
            <KycBadge status={kycStatus} />
            <span className="truncate">{email}</span>
          </div>
          <nav className="quick-actions mt-6" aria-label="Quick actions">
            {[
              {
                href: canTrade ? "/dashboard/sell-crypto" : "/dashboard/kyc",
                label: "Sell crypto",
                Icon: ArrowUpRight,
              },
              {
                href: canTrade ? "/dashboard/sell-giftcard" : "/dashboard/kyc",
                label: "Gift cards",
                Icon: GiftIcon,
              },
              {
                href: canTrade ? "/dashboard/buy-crypto" : "/dashboard/kyc",
                label: "Buy crypto",
                Icon: ArrowDownLeft,
              },
              { href: "/dashboard/wallet", label: "Withdraw", Icon: Wallet },
              { href: "/dashboard/alerts", label: "Rate alerts", Icon: Bell },
              {
                href: "/dashboard/referrals",
                label: "Refer & earn",
                Icon: Users,
              },
            ].map(({ href, label, Icon }) => (
              <Link key={label} href={href} className="quick-action">
                <span className="qa-icon">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-end gap-1 text-xs text-white/55">
            <span>Balances</span>
            <BalanceToggle />
          </div>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            {tiles.map((t) => {
              return (
                <div
                  key={t.label}
                  className={`glass relative min-w-0 rounded-2xl px-2.5 py-3 sm:p-4${t.href ? " transition hover:bg-white/15" : ""}`}
                >
                  {t.href && (
                    <Link href={t.href} className="absolute inset-0 z-10 rounded-2xl" aria-label={`Open ${t.label.toLowerCase()}`} />
                  )}
                  <dt className="truncate text-[11px] font-medium text-white/60 sm:text-xs">
                    <span className="sm:hidden">{t.short}</span>
                    <span className="hidden sm:inline">{t.label}</span>
                  </dt>
                  <dd
                    className="money-private mt-1.5 truncate font-[family-name:var(--font-display)] text-base font-bold tabular-nums sm:mt-2 sm:text-2xl"
                    title={t.full}
                  >
                    {t.value}
                  </dd>
                  <dd className="mt-1 truncate text-[11px] text-white/50 sm:text-xs">
                    {t.hint}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- onboarding ------------------------------ */

function Onboarding({
  status,
  reviewNote,
}: {
  status: string;
  reviewNote: string | null;
}) {
  const submitted = status !== "UNVERIFIED";
  const steps = [
    { label: "Create account", state: "done" },
    { label: "Verify identity", state: submitted ? "done" : "current" },
    {
      label: "Desk review",
      state:
        status === "PENDING"
          ? "current"
          : status === "REJECTED"
            ? "failed"
            : "todo",
    },
    { label: "Start trading", state: "todo" },
  ] as const;

  return (
    <section className="card-panel animate-rise stagger-1">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-label">Get set up</p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-xl font-bold text-ink">
            {status === "PENDING"
              ? "Your verification is with our desk"
              : status === "REJECTED"
                ? "Your verification needs another look"
                : "Verify once, then trade freely"}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-ink-soft">
            {status === "PENDING"
              ? "Most reviews finish within a few hours. We will email you as soon as you can trade."
              : status === "REJECTED"
                ? reviewNote
                  ? `Desk note: ${reviewNote}`
                  : "Check your BVN, NIN and bank details, then resubmit."
                : "Add your BVN, NIN and payout bank. We only keep the last 4 digits of your BVN and NIN."}
          </p>
        </div>
        {status !== "PENDING" && (
          <Link href="/dashboard/kyc" className="btn btn-primary text-sm">
            {status === "REJECTED" ? "Resubmit details" : "Verify identity"}
          </Link>
        )}
      </div>
      <ol className="mt-6 grid gap-3 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.label} className={`onboard-step onboard-step--${s.state}`}>
            <span className="onboard-dot">
              {s.state === "done" ? (
                <Check className="h-3.5 w-3.5" />
              ) : s.state === "failed" ? (
                "!"
              ) : (
                i + 1
              )}
            </span>
            <span className="text-sm font-semibold">{s.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------------------------- needs attention ---------------------------- */

function NeedsAttention({ actions }: { actions: DashboardData["actions"] }) {
  return (
    <section>
      <SectionHeader
        title="Needs your attention"
        badge={String(actions.length)}
        hint="Complete payment, then add your reference so the desk can verify."
      />
      <div className="mt-4 space-y-3">
        {actions.map((a) => (
          <article key={a.id} className="attention-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gold/15 text-[#8a6a0a]">
                  <Alert className="h-4.5 w-4.5" />
                </span>
                <div>
                  <p className="font-semibold text-ink">
                    {a.side === "SELL"
                      ? `Send ${a.amountCrypto} ${a.symbol} (${a.network})`
                      : `Pay ${formatNgn(a.amountNgn)} for ${a.amountCrypto} ${a.symbol}`}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {a.reference} · created {ago(a.createdAt)}
                  </p>
                </div>
              </div>
              <p className="text-right text-sm">
                <span className="block text-xs text-[var(--muted)]">
                  {a.side === "SELL" ? "You receive" : "You pay"}
                </span>
                <span className="font-bold tabular-nums text-ink">
                  {formatNgn(a.amountNgn)}
                </span>
              </p>
            </div>
            <div className="mt-4 rounded-xl bg-paper px-3 py-2.5">
              <p className="text-xs font-medium text-[var(--muted)]">
                {a.payTo.label}
              </p>
              <div className="mt-1 flex items-center justify-between gap-3">
                <code className="min-w-0 break-all font-mono text-sm text-ink">
                  {a.payTo.value}
                </code>
                <CopyButton value={a.payTo.value} />
              </div>
              {a.payTo.detail && (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {a.payTo.detail}
                </p>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-soft">
                {a.side === "SELL"
                  ? "Only send on the network shown. Wrong-network deposits can be lost."
                  : "Pay from an account in your own name."}
              </p>
              <Link
                href={orderHref(a.id)}
                className="text-sm font-bold text-accent-deep hover:underline"
              >
                {a.side === "SELL"
                  ? "I've sent it - add TX hash"
                  : "I've paid - add reference"}{" "}
                &rarr;
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ in progress ------------------------------ */

function InProgress({ orders }: { orders: ActivityItem[] }) {
  return (
    <section>
      <SectionHeader title="In progress" hint="Live status from the desk." />
      <div className="mt-4 grid gap-3">
        {orders.map((o) => (
          <Link
            key={o.id}
            href={orderHref(o.id)}
            className="card-panel block transition hover:border-accent"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <ActivityIcon kind={o.kind} />
                <div>
                  <p className="font-semibold text-ink">{o.title}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {o.reference} · {ago(o.createdAt)}
                  </p>
                </div>
              </div>
              <span className="font-bold tabular-nums text-ink">
                {formatNgn(o.amountNgn)}
              </span>
            </div>
            <div className="mt-5">
              <OrderTracker kind={o.kind} status={o.status} />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------- recent activity ---------------------------- */

function ActivityIcon({ kind }: { kind: ActivityItem["kind"] }) {
  const cls = "grid h-10 w-10 shrink-0 place-items-center rounded-full";
  if (kind === "gift") {
    return (
      <span className={`${cls} bg-gold/15 text-[#8a6a0a]`}>
        <GiftIcon />
      </span>
    );
  }
  if (kind === "crypto-buy") {
    return (
      <span className={`${cls} bg-paper-deep text-ink`}>
        <ArrowDownLeft />
      </span>
    );
  }
  return (
    <span className={`${cls} bg-emerald-50 text-accent-deep`}>
      <ArrowUpRight />
    </span>
  );
}

function RecentActivity({
  items,
  kycStatus,
}: {
  items: ActivityItem[];
  kycStatus: string;
}) {
  const canTrade = kycStatus === "APPROVED";
  const inReview = kycStatus === "PENDING";
  return (
    <section>
      <SectionHeader
        title="Recent activity"
        action={
          items.length > 0 ? (
            <Link
              href="/dashboard/orders"
              className="text-sm font-semibold text-accent-deep hover:underline"
            >
              View all
            </Link>
          ) : null
        }
      />
      {items.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[var(--line)] bg-white/60 px-6 py-10 text-center">
          <p className="font-semibold text-ink">No trades yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
            {canTrade
              ? "Sell USDT, BTC or ETH, buy crypto with Naira, or trade a gift card. Your orders will show up here."
              : inReview
                ? "Trading unlocks as soon as the desk approves your verification. Check today's rates in the meantime."
                : "Once your identity is verified you can start trading. Orders will show up here."}
          </p>
          {inReview ? (
            <Link href="/rates" className="btn btn-ghost mt-5 text-sm">
              See today&apos;s rates
            </Link>
          ) : (
            <Link
              href={canTrade ? "/dashboard/sell-crypto" : "/dashboard/kyc"}
              className="btn btn-dark mt-5 text-sm"
            >
              {canTrade ? "Start your first trade" : "Verify identity"}
            </Link>
          )}
        </div>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          {items.map((o) => {
            const failed = isFailedOrderStatus(o.status);
            const incoming = o.kind !== "crypto-buy";
            return (
              <li
                key={o.id}
                className="border-b border-[var(--line)] last:border-b-0"
              >
                <Link
                  href={orderHref(o.id)}
                  className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-paper"
                >
                  <ActivityIcon kind={o.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">
                      {o.title}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {o.subtitle} · {ago(o.createdAt)}
                    </span>
                    {failed && o.adminNote && (
                      <span className="mt-0.5 block truncate text-xs text-danger">
                        {o.adminNote}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`block font-bold tabular-nums ${failed ? "text-[var(--muted)] line-through" : "text-ink"}`}
                    >
                      {incoming ? "+" : "-"}
                      {formatNgn(o.amountNgn)}
                    </span>
                    <span className="mt-1 inline-block">
                      <StatusPill status={o.status} />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------- sidebar -------------------------------- */

function DeskRates({ rates }: { rates: DashboardData["rates"] }) {
  const rows = [
    { label: "USDT · you sell", value: rates.usdtSell, suffix: "" },
    { label: "USDT · you buy", value: rates.usdtBuy, suffix: "" },
    ...(rates.bestGift
      ? [
          {
            label: `${rates.bestGift.name.replace(/ Gift Card$/i, "")} gift card`,
            value: rates.bestGift.rate,
            suffix: "/$",
          },
        ]
      : []),
  ];
  return (
    <section className="card-panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-ink">
          <span className="live-dot" aria-hidden /> Desk rates
        </h2>
        <Link
          href="/rates"
          className="text-xs font-semibold text-accent-deep hover:underline"
        >
          All rates
        </Link>
      </div>
      <ul className="mt-3 divide-y divide-[var(--line)] text-sm">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <span className="text-ink-soft">{r.label}</span>
            <span className="font-bold tabular-nums text-ink">
              {r.value != null ? `${formatNgn(r.value)}${r.suffix}` : "N/A"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Your order locks at the desk rate when you create it
        {rates.updatedAt
          ? ` · updated ${formatClockTime(rates.updatedAt)} WAT`
          : ""}
        .
      </p>
    </section>
  );
}

function PayoutAccount({ kyc }: { kyc: DashboardData["kyc"] }) {
  const hasBank = !!(kyc?.bankName && kyc.accountNumber);
  return (
    <section className="card-panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-ink">Payout account</h2>
        <Link
          href="/dashboard/kyc"
          className="text-xs font-semibold text-accent-deep hover:underline"
        >
          {hasBank ? "Change" : "Add"}
        </Link>
      </div>
      {hasBank ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-paper-deep text-ink">
            <Bank className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">
              {kyc!.accountName}
            </p>
            <p className="text-sm text-ink-soft">
              {kyc!.bankName} ·{" "}
              <span className="tabular-nums">
                •••• {kyc!.accountNumber!.slice(-4)}
              </span>
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-soft">
          Add a bank account in your name to receive Naira payouts.
        </p>
      )}
      {hasBank && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Changing it sends your verification back for review.
        </p>
      )}
    </section>
  );
}

function SectionHeader({
  title,
  hint,
  badge,
  action,
}: {
  title: string;
  hint?: string;
  badge?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 font-[family-name:var(--font-display)] text-lg font-bold text-ink">
          {title}
          {badge && (
            <span className="rounded-full bg-gold/20 px-2 py-0.5 text-xs font-bold text-[#8a6a0a]">
              {badge}
            </span>
          )}
        </h2>
        {hint && <p className="mt-0.5 text-sm text-ink-soft">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

function DeskSpeed({ speed }: { speed: DashboardData["deskSpeed"] }) {
  if (speed.completed === 0) return null;
  return (
    <section className="card-panel">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-ink">Desk speed</h2>
        <span className="text-xs text-[var(--muted)]">
          Last {speed.days} days
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        Median time from order to Naira, on real completed trades.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-paper px-3 py-2.5">
          <dt className="text-xs text-[var(--muted)]">Gift cards</dt>
          <dd className="mt-0.5 text-lg font-bold tabular-nums text-ink">
            {formatDuration(speed.giftMedianMin)}
          </dd>
        </div>
        <div className="rounded-xl bg-paper px-3 py-2.5">
          <dt className="text-xs text-[var(--muted)]">Crypto sells</dt>
          <dd className="mt-0.5 text-lg font-bold tabular-nums text-ink">
            {formatDuration(speed.cryptoMedianMin)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
