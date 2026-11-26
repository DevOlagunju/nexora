import { SectionLink as Link } from "@/components/admin/section-link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ago } from "@/lib/admin-overview-rules";
import { CATEGORY_LABEL, SUPPORT_STATUS_LABEL_STAFF, SUPPORT_STATUS_STYLE as STATUS_STYLE } from "@/lib/support-rules";
import { listTicketsForStaff } from "@/lib/services/support";
import { SearchIcon } from "@/components/admin/icons";
import type { SupportStatus } from "@/generated/prisma/enums";

export const metadata = { title: "Support · Nexora admin" };

const FILTERS = [
  { key: "active", label: "Active" },
  { key: "OPEN", label: "Needs a reply" },
  { key: "AWAITING_CUSTOMER", label: "Waiting on customer" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CLOSED", label: "Closed" },
  { key: "all", label: "All" },
] as const;

/** Customers' support tickets: the ones needing a reply first, oldest waiting at the top. */
export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  const params = await searchParams;
  const { status, q, tickets, counts } = await listTicketsForStaff({ status: params.status, q: params.q });
  const href = (s: string) => {
    const p = new URLSearchParams();
    if (s !== "active") p.set("status", s);
    if (q) p.set("q", q);
    const qs = p.toString();
    return qs ? `/admin/support?${qs}` : "/admin/support";
  };
  const countFor = (key: string) =>
    key === "active" ? (counts.OPEN ?? 0) + (counts.AWAITING_CUSTOMER ?? 0) : key === "all" ? undefined : counts[key as SupportStatus];

  return (
    <div className="mx-auto max-w-[96rem]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-ink">Support</h1>
          <p className="mt-1 max-w-2xl text-ink-soft">
            Questions and complaints from customers, oldest waiting first. A customer&apos;s reply puts a ticket back under
            &quot;Needs a reply&quot;.
          </p>
        </div>
        <form className="admin-search min-w-[18rem]" role="search">
          {status !== "active" ? <input type="hidden" name="status" value={status} /> : null}
          <SearchIcon className="h-5 w-5 text-[var(--muted)]" />
          <input name="q" defaultValue={q} placeholder="Ticket, order reference, name or email" aria-label="Search tickets" />
        </form>
      </div>

      <nav className="mt-5 flex flex-wrap gap-2" aria-label="Filter">
        {FILTERS.map((f) => {
          const n = countFor(f.key);
          return (
            <Link
              key={f.key}
              href={href(f.key)}
              aria-current={f.key === status ? "page" : undefined}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
                f.key === status ? "border-accent bg-accent text-white" : "border-[var(--line)] bg-white text-ink-soft hover:border-accent hover:text-accent-deep"
              }`}
            >
              {f.label}
              {n !== undefined ? <span className="ml-1.5 opacity-75">{n}</span> : null}
            </Link>
          );
        })}
      </nav>

      <section className="admin-card mt-5 p-5">
        {tickets.length === 0 ? (
          <p className="text-sm text-ink-soft">{q ? "No ticket matches that." : status === "active" ? "No open tickets. All caught up." : "Nothing here."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4 font-semibold">Ticket</th>
                  <th className="pb-2 pr-4 font-semibold">Customer</th>
                  <th className="pb-2 pr-4 font-semibold">About</th>
                  <th className="pb-2 pr-4 font-semibold">Status</th>
                  <th className="pb-2 pr-4 font-semibold">With</th>
                  <th className="pb-2 text-right font-semibold">Customer last wrote</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)] align-top">
                {tickets.map((t) => (
                  <tr key={t.id}>
                    <td className="py-3 pr-4">
                      <Link href={`/admin/support/${t.id}`} className="font-bold text-ink hover:text-accent-deep hover:underline">
                        {t.subject}
                      </Link>
                      <p className="font-mono text-[11px] text-[var(--muted)]">
                        {t.reference} · {t._count.messages} message{t._count.messages === 1 ? "" : "s"}
                      </p>
                    </td>
                    <td className="py-3 pr-4">
                      <p className="font-semibold text-ink">{t.user.fullName}</p>
                      <p className="text-xs text-ink-soft">{t.user.email}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-ink">{CATEGORY_LABEL[t.category]}</p>
                      {t.orderReference ? <p className="font-mono text-[11px] text-ink-soft">{t.orderReference}</p> : null}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[t.status]}`}>
                        {SUPPORT_STATUS_LABEL_STAFF[t.status]}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-ink-soft">{t.assignedTo?.fullName ?? "Unassigned"}</td>
                    <td className="whitespace-nowrap py-3 text-right text-xs text-[var(--muted)]">{ago(t.lastCustomerAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
