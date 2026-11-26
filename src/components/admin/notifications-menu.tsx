"use client";

import { useState, useSyncExternalStore } from "react";
import { Popover } from "@/components/admin/popover";
import { SectionLink } from "@/components/admin/section-link";
import { AlertIcon, ArrowRightIcon, BellIcon, CheckCircleIcon } from "@/components/admin/icons";
import { parseSeen, unseenIds } from "@/lib/admin-overview-rules";

export type NotificationItem = { id: string; title: string; detail: string; href: string; at: string; urgent: boolean };

function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const SEEN_EVENT = "nexora:bell-seen";

/** What this browser has already shown this staff member, kept in localStorage. */
function useSeen(key: string) {
  const raw = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(SEEN_EVENT, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(SEEN_EVENT, onChange);
      };
    },
    () => window.localStorage.getItem(key),
    // On the server nothing is known yet: no badge until the browser has checked.
    () => undefined,
  );
  const markSeen = (ids: string[]) => {
    // Only what is still waiting is kept, so the list never grows.
    window.localStorage.setItem(key, JSON.stringify(ids));
    window.dispatchEvent(new Event(SEEN_EVENT));
  };
  return { known: raw !== undefined, seen: parseSeen(raw ?? null), markSeen };
}

/**
 * The bell: what is waiting for staff right now, risks first, each linking to where it is handled.
 * The badge counts only work this person has not seen yet; opening the bell marks it all seen.
 * The list keeps showing everything still waiting until it is dealt with on the desk.
 */
export function NotificationsMenu({
  total,
  items,
  ids,
  viewerId,
}: {
  total: number;
  items: NotificationItem[];
  /** Every waiting item's id (not only the ones listed). */
  ids: string[];
  /** The signed-in staff member, so two people sharing a browser keep separate "seen" lists. */
  viewerId: string;
}) {
  const { known, seen, markSeen } = useSeen(`nexora:bell-seen:${viewerId}`);
  const unseen = known ? unseenIds(ids, seen) : [];
  // Which ones were new when the panel opened, so they stay highlighted while it is open.
  const [newOnOpen, setNewOnOpen] = useState<ReadonlySet<string>>(new Set());

  return (
    <Popover
      label={unseen.length > 0 ? `Notifications, ${unseen.length} new, ${total} waiting` : `Notifications, ${total} waiting`}
      buttonClassName="admin-icon-btn relative"
      panelClassName="w-[22rem] max-w-[calc(100vw-2rem)]"
      onOpen={() => {
        setNewOnOpen(new Set(unseen));
        markSeen(ids);
      }}
      button={
        <>
          <BellIcon />
          {unseen.length > 0 ? <span className="admin-bell-badge">{unseen.length > 99 ? "99+" : unseen.length}</span> : null}
        </>
      }
    >
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <p className="font-bold text-ink">Notifications</p>
          <span className="text-xs font-semibold text-[var(--muted)]">
            {newOnOpen.size > 0 ? `${newOnOpen.size} new · ` : ""}
            {total} waiting
          </span>
        </div>
        {items.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-6 text-sm text-ink-soft">
            <CheckCircleIcon className="h-6 w-6 text-accent" /> All clear. Nothing is waiting for the desk.
          </div>
        ) : (
          <ul className="max-h-[22rem] divide-y divide-[var(--line)] overflow-y-auto">
            {items.map((n) => {
              const fresh = newOnOpen.has(n.id);
              return (
                <li key={n.id}>
                  <SectionLink href={n.href} className={`flex items-start gap-3 px-4 py-3 hover:bg-paper ${fresh ? "bg-accent-soft/40" : ""}`}>
                    <span
                      className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${n.urgent ? "bg-[#fdecec] text-danger" : "bg-accent-soft text-accent-deep"}`}
                    >
                      {n.urgent ? <AlertIcon className="h-4 w-4" /> : <CheckCircleIcon className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm text-ink ${fresh ? "font-extrabold" : "font-semibold"}`}>{n.title}</span>
                      <span className="block truncate text-xs text-ink-soft">{n.detail}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-[var(--muted)]">
                      {ago(n.at)}
                      {fresh ? <span className="h-2 w-2 rounded-full bg-accent" aria-label="new" /> : null}
                    </span>
                  </SectionLink>
                </li>
              );
            })}
          </ul>
        )}
        <SectionLink href="/admin/desk#approvals" className="flex items-center justify-center gap-1 border-t border-[var(--line)] px-4 py-3 text-sm font-bold text-accent-deep hover:bg-paper">
          Open the desk <ArrowRightIcon className="h-4 w-4" />
        </SectionLink>
      </div>
    </Popover>
  );
}
