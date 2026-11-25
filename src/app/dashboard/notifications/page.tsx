import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDistanceToNowStrict } from "date-fns";
import { markNotificationsReadAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { listNotifications } from "@/lib/services/notifications";
import { ActionForm } from "@/components/action-form";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const items = await listNotifications(user.id, 50);
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-label">Inbox</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">Notifications</h1>
        </div>
        {unread > 0 && (
          <ActionForm
            action={markNotificationsReadAction}
            submitLabel={`Mark ${unread} as read`}
            submitVariant="ghost"
            resetOnSuccess={false}
            className="[&_button]:mt-0 [&_button]:w-auto [&_button]:text-sm"
          />
        )}
      </div>
      {items.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-[var(--line)] bg-white/60 px-5 py-8 text-center text-sm text-ink-soft">
          Order updates, wallet credits, rate alerts and security notices will show up here.
        </p>
      ) : (
        <ul className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          {items.map((n) => {
            const body = (
              <span className="flex items-start gap-2">
                {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.readAt ? "font-medium" : "font-bold"} text-ink`}>{n.title}</span>
                  <span className="mt-0.5 block text-sm text-ink-soft">{n.body}</span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">
                    {formatDistanceToNowStrict(n.createdAt, { addSuffix: true })}
                  </span>
                </span>
              </span>
            );
            return (
              <li key={n.id} className="ledger-row">
                {n.href ? (
                  <Link href={n.href} className="block px-4 py-3.5 transition hover:bg-paper">
                    {body}
                  </Link>
                ) : (
                  <div className="px-4 py-3.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
