import { SectionLink as Link } from "@/components/admin/section-link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { adminOverview, pendingWork, recentActivity, recentTransactions, systemStatus, type ActivityItem, type TransactionRow } from "@/lib/services/admin-overview";
import { ago, compactNgn, formatPct, OVERVIEW_RANGES, parseRange, type OverviewRange } from "@/lib/admin-overview-rules";
import { formatNgn } from "@/lib/format";
import { StatusPill } from "@/components/status-pill";
import { PerformanceChart, Sparkline } from "@/components/admin/charts";
import { Popover } from "@/components/admin/popover";
import {
  ActivityIcon,
  AlertIcon,
  ArrowRightIcon,
  BankIcon,
  CalendarIcon,
  ChartIcon,
  CheckCircleIcon,
  CoinsIcon,
  DownloadIcon,
  GiftIcon,
  IdCardIcon,
  RocketIcon,
  SwapIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/admin/icons";

export const metadata = { title: "Dashboard · Nexora admin" };

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  const range = parseRange((await searchParams).range);
  const showMoney = can(user, "reports.view");
  const [overview, activity, transactions, pending] = await Promise.all([
    adminOverview(range),
    recentActivity(5),
    recentTransactions(6),
    pendingWork(5),
  ]);
  // After the rest, so the database ping measures the database rather than the queue of queries above.
  const status = await systemStatus();
  const { kpis } = overview;
  const allOk = status.checks.every((c) => c.ok);
  const firstName = user.fullName.split(/\s+/)[0] || "there";

  return (
    <div className="mx-auto max-w-[96rem]">
      {/* Greeting and period */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-ink">Welcome back, {firstName} 👋</h1>
          <p className="mt-1 text-ink-soft">Here&apos;s what&apos;s happening on your Nexora platform today.</p>
        </div>
        <RangePicker current={range} />
      </div>

      {/* KPIs and promo */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Total Users"
          value={kpis.users.value.toLocaleString("en-NG")}
          change={kpis.users.change}
          series={kpis.users.series}
          icon={<UsersIcon className="h-7 w-7" />}
          tone="solid"
          hint={`${kpis.users.newInPeriod.toLocaleString("en-NG")} joined in this period`}
        />
        <KpiCard
          label="Total Volume"
          value={compactNgn(kpis.volume.value)}
          change={kpis.volume.change}
          series={kpis.volume.series}
          icon={<SwapIcon className="h-7 w-7" />}
          tone="soft"
          hint="Completed trades"
        />
        <KpiCard
          label="Total Revenue"
          value={showMoney ? compactNgn(kpis.revenue.value) : "Hidden"}
          change={showMoney ? kpis.revenue.change : null}
          series={showMoney ? kpis.revenue.series : []}
          icon={<WalletIcon className="h-7 w-7" />}
          tone="gold"
          hint={showMoney ? "Spread earned plus fees" : "Your role can't see earnings"}
        />
        <KpiCard
          label="Successful Trades"
          value={kpis.success.value === null ? "-" : formatPct(kpis.success.value)}
          change={kpis.success.change}
          changeUnit="pts"
          series={kpis.success.series}
          icon={<CheckCircleIcon className="h-7 w-7" />}
          tone="solid"
          hint={`${kpis.success.trades.toLocaleString("en-NG")} trades finished`}
        />
        <div className="admin-promo sm:col-span-2 xl:col-span-1">
          <RocketIcon className="absolute -right-2 top-3 h-28 w-28 rotate-12 text-white/15" />
          <p className="font-[family-name:var(--font-display)] text-xl font-bold leading-tight">
            Nexora
            <br />
            Growing Together
          </p>
          <p className="mt-2 text-sm text-white/80">
            More users. More trades.
            <br />A stronger platform.
          </p>
          <Link
            href={showMoney ? "/admin/desk#earnings" : "/admin/desk"}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-accent-deep"
          >
            {showMoney ? "View Analytics" : "Open the desk"} <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Performance and activity */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="admin-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
              <ChartIcon className="h-5 w-5 text-accent" /> Platform Performance
            </h2>
            <div className="flex flex-wrap items-center gap-4 text-sm text-ink-soft">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-accent-deep" /> Volume (₦)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#5be38f]" /> New customers
              </span>
              <div className="flex gap-1.5">
                {(Object.keys(OVERVIEW_RANGES) as OverviewRange[]).map((r) => (
                  <Link key={r} href={`/admin?range=${r}`} scroll={false} className={`admin-chip ${r === range ? "admin-chip--on" : ""}`}>
                    {OVERVIEW_RANGES[r].short}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4">
            <PerformanceChart labels={overview.labels} volume={overview.chart.volume} signups={overview.chart.signups} />
          </div>
        </section>

        <section className="admin-card p-5">
          <CardHead title="Recent Activities" href="/admin/desk" />
          {activity.length === 0 ? (
            <p className="mt-4 text-sm text-ink-soft">Nothing has happened yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {activity.map((a, i) => (
                <ActivityRow key={i} a={a} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Transactions, approvals, status */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2 min-[1700px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_22rem]">
        <section className="admin-card p-5 lg:col-span-2 min-[1700px]:col-span-1">
          <CardHead title="Recent Transactions" href="/admin/desk#crypto" />
          {transactions.length === 0 ? (
            <p className="mt-4 text-sm text-ink-soft">No transactions yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead>
                  <tr className="text-xs text-[var(--muted)]">
                    <th className="pb-2 font-semibold">Type</th>
                    <th className="pb-2 font-semibold">User</th>
                    <th className="pb-2 font-semibold">Amount</th>
                    <th className="pb-2 font-semibold">Status</th>
                    <th className="pb-2 text-right font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {transactions.map((t) => (
                    <TransactionLine key={`${t.type}-${t.id}`} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="admin-card p-5">
          <CardHead
            title={
              <>
                Pending Approvals
                {pending.total > 0 ? (
                  <span className="ml-2 rounded-full bg-gold/25 px-2 py-0.5 text-xs font-bold text-[#7a5200]">{pending.total}</span>
                ) : null}
              </>
            }
            href="/admin/desk#approvals"
          />
          {pending.items.length === 0 ? (
            <p className="mt-4 text-sm text-ink-soft">Nothing is waiting. The queue is clear.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {pending.items.map((p) => (
                <li key={`${p.kind}-${p.id}`} className="flex items-center gap-3 py-2.5">
                  <PendingIcon kind={p.kind} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink" title={p.title}>
                      {p.title}
                    </p>
                    <p className="truncate text-xs text-ink-soft" title={p.detail}>
                      {p.detail}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Link
                      href={p.href}
                      className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${p.action === "Investigate" ? "bg-gold/25 text-[#7a5200]" : "bg-accent-soft text-accent-deep"}`}
                    >
                      {p.action}
                    </Link>
                    <span className="whitespace-nowrap text-[11px] text-[var(--muted)]">{ago(p.at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-card p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-ink">System Status</h2>
            <span className={`flex items-center gap-1.5 text-xs font-bold ${allOk ? "text-accent-deep" : "text-[#7a5200]"}`}>
              <span className={`h-2 w-2 rounded-full ${allOk ? "bg-accent" : "bg-gold"}`} />
              {allOk ? "All systems operational" : "Needs attention"}
            </span>
          </div>
          <ul className="mt-3 space-y-2.5">
            {status.checks.map((c) => (
              <li key={c.name} className="flex items-start gap-2.5 text-sm">
                {c.ok ? <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" /> : <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-gold" />}
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{c.name}</p>
                  <p className="text-xs text-ink-soft">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-4 border-t border-[var(--line)] pt-4">
            <ActivityIcon className="h-6 w-6 text-accent" />
            <div>
              <p className="text-xs text-[var(--muted)]">Server up for</p>
              <p className="font-bold text-ink">{uptime(status.serverUpSeconds)}</p>
            </div>
            <div className="h-8 w-px bg-[var(--line)]" />
            <div>
              <p className="text-xs text-[var(--muted)]">Database response</p>
              <p className="font-bold text-ink">{status.dbMs === null ? "Down" : `${status.dbMs} ms`}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function uptime(seconds: number) {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function RangePicker({ current }: { current: OverviewRange }) {
  return (
    <Popover
      label={`Period: ${OVERVIEW_RANGES[current].label}. Change`}
      buttonClassName="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-sm hover:border-accent"
      panelClassName="w-48"
      button={
        <>
          <CalendarIcon className="h-4 w-4 text-ink-soft" />
          {OVERVIEW_RANGES[current].label}
          <span aria-hidden="true">▾</span>
        </>
      }
    >
      <div className="rounded-xl border border-[var(--line)] bg-white p-1.5 shadow-xl">
        {(Object.keys(OVERVIEW_RANGES) as OverviewRange[]).map((r) => (
          <Link
            key={r}
            href={`/admin?range=${r}`}
            className={`block rounded-lg px-3 py-2 text-sm ${r === current ? "bg-accent-soft font-bold text-accent-deep" : "text-ink hover:bg-paper"}`}
          >
            {OVERVIEW_RANGES[r].label}
          </Link>
        ))}
      </div>
    </Popover>
  );
}

function KpiCard({
  label,
  value,
  change,
  changeUnit = "%",
  series,
  icon,
  tone,
  hint,
}: {
  label: string;
  value: string;
  change: number | null;
  changeUnit?: "%" | "pts";
  series: number[];
  icon: React.ReactNode;
  tone: "solid" | "soft" | "gold";
  hint: string;
}) {
  const iconClass =
    tone === "solid" ? "bg-accent text-white" : tone === "gold" ? "bg-gold/20 text-[#7a5200]" : "bg-accent-soft text-accent-deep";
  const up = change !== null && change >= 0;
  return (
    <div className="admin-card admin-kpi">
      <div className="flex items-start gap-3">
        <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${iconClass}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-tight text-ink-soft">{label}</p>
          <p className="font-[family-name:var(--font-display)] text-[1.7rem] font-bold leading-tight text-ink">{value}</p>
          {change !== null ? (
            <p className={`text-sm font-bold ${up ? "text-accent-deep" : "text-danger"}`}>
              {up ? "↑" : "↓"} {changeUnit === "pts" ? `${Math.abs(change).toFixed(1)} pts` : formatPct(Math.abs(change))}
            </p>
          ) : (
            <p className="text-xs text-[var(--muted)]">{hint}</p>
          )}
        </div>
      </div>
      <Sparkline values={series} className="mt-2 h-12 w-full" />
      {change !== null ? <p className="sr-only">{hint}</p> : null}
    </div>
  );
}

function CardHead({ title, href }: { title: React.ReactNode; href: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex min-w-0 items-center whitespace-nowrap text-lg font-bold text-ink">{title}</h2>
      <Link href={href} className="flex shrink-0 items-center gap-1 whitespace-nowrap text-sm font-bold text-accent-deep hover:underline">
        View All <ArrowRightIcon className="h-4 w-4" />
      </Link>
    </div>
  );
}

function ActivityRow({ a }: { a: ActivityItem }) {
  const style = {
    deposit: { icon: <DownloadIcon className="h-5 w-5" />, cls: "bg-accent-soft text-accent-deep" },
    gift: { icon: <GiftIcon className="h-5 w-5" />, cls: "bg-[#e7efff] text-[#2563eb]" },
    kyc: { icon: <CheckCircleIcon className="h-5 w-5" />, cls: "bg-accent-soft text-accent-deep" },
    flag: { icon: <AlertIcon className="h-5 w-5" />, cls: "bg-gold/20 text-[#7a5200]" },
    signup: { icon: <UsersIcon className="h-5 w-5" />, cls: "bg-paper text-ink-soft" },
  }[a.kind];
  return (
    <li className="flex items-center gap-3 py-3">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${style.cls}`}>{style.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">{a.title}</p>
        <p className="truncate text-xs text-ink-soft">{a.detail}</p>
      </div>
      <div className="text-right">
        {a.amountNgn !== undefined ? <p className="text-sm font-bold text-ink">{formatNgn(a.amountNgn)}</p> : null}
        <p className="text-xs text-[var(--muted)]">{ago(a.at)}</p>
      </div>
    </li>
  );
}

const COIN_BG: Record<string, string> = { BTC: "#F7931A", ETH: "#7B61FF", USDT: "#26A17B", USDC: "#2775CA", SOL: "#1B1B2F", BNB: "#F3BA2F" };

function TransactionLine({ t }: { t: TransactionRow }) {
  const icon =
    t.type === "Sell Crypto" || t.type === "Buy Crypto" ? (
      <span className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-black text-white" style={{ background: COIN_BG[t.symbol ?? ""] ?? "#0a4f2a" }}>
        {(t.symbol ?? "?").slice(0, 1)}
      </span>
    ) : t.type === "Gift Card" ? (
      <GiftIcon className="h-6 w-6 text-accent-deep" />
    ) : t.type === "Withdrawal" ? (
      <BankIcon className="h-6 w-6 text-[#b7791f]" />
    ) : (
      <DownloadIcon className="h-6 w-6 text-[#2563eb]" />
    );
  return (
    <tr className="whitespace-nowrap">
      <td className="py-2.5 pr-3">
        <span className="flex items-center gap-2.5 font-semibold text-ink">
          {icon}
          {t.type}
        </span>
      </td>
      <td className="max-w-[9rem] truncate py-2.5 pr-3 text-ink-soft" title={t.user}>
        {t.user}
      </td>
      <td className="py-2.5 pr-3 font-bold text-ink">{t.amountLabel ?? formatNgn(t.amountNgn)}</td>
      <td className="py-2.5">
        <StatusPill status={t.status} />
      </td>
      <td className="py-2.5 text-right text-xs text-[var(--muted)]">{ago(t.at)}</td>
    </tr>
  );
}

function PendingIcon({ kind }: { kind: string }) {
  const map: Record<string, { icon: React.ReactNode; cls: string }> = {
    crypto: { icon: <CoinsIcon className="h-5 w-5" />, cls: "bg-gold/20 text-[#7a5200]" },
    gift: { icon: <GiftIcon className="h-5 w-5" />, cls: "bg-paper text-ink" },
    withdrawal: { icon: <BankIcon className="h-5 w-5" />, cls: "bg-gold/20 text-[#7a5200]" },
    kyc: { icon: <IdCardIcon className="h-5 w-5" />, cls: "bg-[#e7efff] text-[#2563eb]" },
    approval: { icon: <CheckCircleIcon className="h-5 w-5" />, cls: "bg-accent-soft text-accent-deep" },
    deposit: { icon: <DownloadIcon className="h-5 w-5" />, cls: "bg-[#fdecec] text-danger" },
    fraud: { icon: <AlertIcon className="h-5 w-5" />, cls: "bg-[#fdecec] text-danger" },
  };
  const s = map[kind] ?? map.approval;
  return <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${s.cls}`}>{s.icon}</span>;
}
