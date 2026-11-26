"use client";

import { Popover } from "@/components/admin/popover";
import { SectionLink } from "@/components/admin/section-link";
import { AlertIcon, ArrowRightIcon, BellIcon, CheckCircleIcon } from "@/components/admin/icons";

export type NotificationItem = { id: string; title: string; detail: string; href: string; at: string; urgent: boolean };

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** The bell: what is waiting for staff right now, risks first, each linking to where it is handled. */
export function NotificationsMenu({ total, items }: { total: number; items: NotificationItem[] }) {
  return (
    <Popover
      label={total > 0 ? `Notifications, ${total} waiting` : "Notifications"}
      buttonClassName="admin-icon-btn relative"
      panelClassName="w-[22rem] max-w-[calc(100vw-2rem)]"
      button={
        <>
          <BellIcon />
          {total > 0 ? <span className="admin-bell-badge">{total > 99 ? "99+" : total}</span> : null}
        </>
      }
    >
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <p className="font-bold text-ink">Notifications</p>
          <span className="text-xs font-semibold text-[var(--muted)]">{total} waiting</span>
        </div>
        {items.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-6 text-sm text-ink-soft">
            <CheckCircleIcon className="h-6 w-6 text-accent" /> All clear. Nothing is waiting for the desk.
          </div>
        ) : (
          <ul className="max-h-[22rem] divide-y divide-[var(--line)] overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <SectionLink href={n.href} className="flex items-start gap-3 px-4 py-3 hover:bg-paper">
                  <span
                    className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${n.urgent ? "bg-[#fdecec] text-danger" : "bg-accent-soft text-accent-deep"}`}
                  >
                    {n.urgent ? <AlertIcon className="h-4 w-4" /> : <CheckCircleIcon className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink">{n.title}</span>
                    <span className="block truncate text-xs text-ink-soft">{n.detail}</span>
                  </span>
                  <span className="shrink-0 text-xs text-[var(--muted)]">{ago(n.at)}</span>
                </SectionLink>
              </li>
            ))}
          </ul>
        )}
        <SectionLink href="/admin/desk#approvals" className="flex items-center justify-center gap-1 border-t border-[var(--line)] px-4 py-3 text-sm font-bold text-accent-deep hover:bg-paper">
          Open the desk <ArrowRightIcon className="h-4 w-4" />
        </SectionLink>
      </div>
    </Popover>
  );
}
