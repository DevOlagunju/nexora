import { SectionLink as Link } from "@/components/admin/section-link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { can, denialMessage } from "@/lib/permissions";
import { formatLagosDateTime } from "@/lib/format";
import { ago } from "@/lib/admin-overview-rules";
import { actionKind, actionLabel, AUDIT_GROUPS, auditGroup, metaPairs, pageNumber, type AuditGroup } from "@/lib/audit-rules";
import { listAuditLog } from "@/lib/services/audit";
import { SearchIcon } from "@/components/admin/icons";

export const metadata = { title: "Audit trail · Nexora admin" };

type Params = { group?: string; q?: string; page?: string };

const KIND_STYLE = {
  staff: "bg-[#fff4d6] text-[#7a5200]",
  customer: "bg-accent-soft text-accent-deep",
  system: "bg-[#eef1f4] text-[#3d4a57]",
} as const;

/**
 * Who did what, and when: sign-ins, orders, payouts, KYC and every desk decision, newest first.
 * Rows cannot be edited or deleted (the database refuses), so this is the record to rely on.
 */
export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  if (!can(user, "audit.view")) {
    return (
      <div className="mx-auto max-w-[96rem]">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-ink">Audit trail</h1>
        <p className="admin-card mt-6 p-5 text-sm text-ink-soft">{denialMessage(user, "audit.view")}</p>
      </div>
    );
  }

  const params = await searchParams;
  const group = auditGroup(params.group);
  const q = (params.q ?? "").trim().slice(0, 100);
  const page = pageNumber(params.page);
  const { rows, hasOlder } = await listAuditLog({ group, q, page });

  const href = (next: Partial<{ group: AuditGroup; q: string; page: number }>) => {
    const s = new URLSearchParams();
    const g = next.group ?? group;
    const text = next.q ?? q;
    const p = next.page ?? 1;
    if (g !== "all") s.set("group", g);
    if (text) s.set("q", text);
    if (p > 1) s.set("page", String(p));
    const qs = s.toString();
    return qs ? `/admin/audit?${qs}` : "/admin/audit";
  };

  return (
    <div className="mx-auto max-w-[96rem]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-ink">Audit trail</h1>
          <p className="mt-1 max-w-2xl text-ink-soft">
            Every sign-in, order, payout and desk decision, newest first. Entries can&apos;t be edited or deleted.
          </p>
        </div>
        <form className="admin-search min-w-[18rem]" role="search">
          {group !== "all" ? <input type="hidden" name="group" value={group} /> : null}
          <SearchIcon className="h-5 w-5 text-[var(--muted)]" />
          <input name="q" defaultValue={q} placeholder="Name, email, reference or action" aria-label="Search the audit trail" />
        </form>
      </div>

      <nav className="mt-5 flex flex-wrap gap-2" aria-label="Filter">
        {(Object.keys(AUDIT_GROUPS) as AuditGroup[]).map((g) => (
          <Link
            key={g}
            href={href({ group: g })}
            aria-current={g === group ? "page" : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
              g === group ? "border-accent bg-accent text-white" : "border-[var(--line)] bg-white text-ink-soft hover:border-accent hover:text-accent-deep"
            }`}
          >
            {AUDIT_GROUPS[g].label}
          </Link>
        ))}
      </nav>

      <section className="admin-card mt-5 p-5">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-soft">{q || group !== "all" ? "Nothing matches that filter." : "Nothing recorded yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4 font-semibold">When (Lagos)</th>
                  <th className="pb-2 pr-4 font-semibold">Who</th>
                  <th className="pb-2 pr-4 font-semibold">What</th>
                  <th className="pb-2 pr-4 font-semibold">Details</th>
                  <th className="pb-2 text-right font-semibold">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)] align-top">
                {rows.map((r) => {
                  const kind = actionKind(r.action);
                  const pairs = metaPairs(r.meta);
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap py-3 pr-4">
                        <p className="text-ink">{formatLagosDateTime(r.createdAt)}</p>
                        <p className="text-xs text-[var(--muted)]">{ago(r.createdAt)}</p>
                      </td>
                      <td className="py-3 pr-4">
                        {r.user ? (
                          <>
                            <p className="font-semibold text-ink">
                              {r.user.fullName}
                              {r.user.role === "ADMIN" ? <span className="ml-1.5 rounded bg-[#fff4d6] px-1.5 py-0.5 text-[10px] font-bold text-[#7a5200]">STAFF</span> : null}
                            </p>
                            <p className="text-xs text-ink-soft">{r.user.email}</p>
                          </>
                        ) : (
                          <p className="text-ink-soft">{kind === "system" ? "System" : "Unknown"}</p>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${KIND_STYLE[kind]}`}>{actionLabel(r.action)}</span>
                        <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">{r.action}</p>
                      </td>
                      <td className="max-w-[34rem] py-3 pr-4">
                        {pairs.length ? (
                          <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            {pairs.map((p) => (
                              <div key={p.key} className="flex gap-1">
                                <dt className="text-[var(--muted)]">{p.key}:</dt>
                                <dd className="break-all font-medium text-ink">{p.value}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">-</span>
                        )}
                      </td>
                      <td className="py-3 text-right font-mono text-[11px] text-[var(--muted)]" title="SHA-256 of the IP address; the address itself is not stored">
                        {r.ipHash ? r.ipHash.slice(0, 10) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {page > 1 || hasOlder ? (
          <div className="mt-4 flex items-center justify-between border-t border-[var(--line)] pt-4 text-sm">
            {page > 1 ? (
              <Link href={href({ page: page - 1 })} className="font-semibold text-accent-deep hover:underline">
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-[var(--muted)]">Page {page}</span>
            {hasOlder ? (
              <Link href={href({ page: page + 1 })} className="font-semibold text-accent-deep hover:underline">
                Older →
              </Link>
            ) : (
              <span />
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
