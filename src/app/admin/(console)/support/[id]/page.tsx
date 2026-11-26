import { SectionLink as Link } from "@/components/admin/section-link";
import { notFound, redirect } from "next/navigation";
import { supportAssignAction, supportReplyAction, supportStatusAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatLagosDateTime } from "@/lib/format";
import { ago } from "@/lib/admin-overview-rules";
import {
  CATEGORY_LABEL,
  isActive,
  staffMovesFrom,
  SUPPORT_STATUS_LABEL_STAFF,
  SUPPORT_STATUS_STYLE,
} from "@/lib/support-rules";
import { getTicketForStaff } from "@/lib/services/support";
import { ActionForm } from "@/components/action-form";

export const metadata = { title: "Support ticket · Nexora admin" };

/** One ticket: the conversation, the customer, the linked transaction, and the reply box. */
export default async function AdminSupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  const t = await getTicketForStaff((await params).id);
  if (!t) notFound();
  const mayAct = can(user, "support.manage");
  const moves = staffMovesFrom(t.status);

  return (
    <div className="mx-auto max-w-[80rem]">
      <Link href="/admin/support" className="text-sm font-semibold text-accent-deep hover:underline">
        ← Support
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">{t.subject}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            <span className="font-mono">{t.reference}</span> · {CATEGORY_LABEL[t.category]} · opened {ago(t.createdAt)}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${SUPPORT_STATUS_STYLE[t.status]}`}>{SUPPORT_STATUS_LABEL_STAFF[t.status]}</span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <section className="admin-card p-5">
          <h2 className="text-lg font-bold text-ink">Conversation</h2>
          <ol className="mt-4 space-y-3">
            {t.messages.map((m) => (
              <li key={m.id} className={`flex ${m.fromStaff ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.fromStaff ? "bg-accent-soft text-ink" : "border border-[var(--line)] bg-white text-ink"}`}>
                  <p className="text-xs font-bold text-ink-soft">
                    {m.fromStaff ? `${m.author?.fullName ?? "Staff"} (staff)` : t.user.fullName}
                    <span className="ml-2 font-normal text-[var(--muted)]">{formatLagosDateTime(m.createdAt)}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                </div>
              </li>
            ))}
          </ol>

          {mayAct && t.status !== "CLOSED" ? (
            <ActionForm action={supportReplyAction} className="mt-5 border-t border-[var(--line)] pt-5" submitLabel="Send reply">
              <input type="hidden" name="id" value={t.id} />
              <label className="block text-sm font-semibold text-ink">
                Reply to {t.user.fullName.split(" ")[0]}
                <textarea className="input mt-1 min-h-28" name="message" required minLength={2} maxLength={2000} placeholder="Write your reply. Never ask for a card code, PIN or password." />
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
                <input type="checkbox" name="resolve" /> Mark resolved after sending
              </label>
            </ActionForm>
          ) : t.status === "CLOSED" ? (
            <p className="mt-5 border-t border-[var(--line)] pt-4 text-sm text-ink-soft">This ticket is closed. The customer can open a new one.</p>
          ) : (
            <p className="mt-5 border-t border-[var(--line)] pt-4 text-sm text-ink-soft">Your role can read tickets but not answer them.</p>
          )}
        </section>

        <aside className="space-y-5">
          <section className="admin-card p-5 text-sm">
            <h2 className="text-lg font-bold text-ink">Customer</h2>
            <p className="mt-2 font-semibold text-ink">{t.user.fullName}</p>
            <p className="text-ink-soft">{t.user.email}</p>
            <p className="text-ink-soft">{t.user.phone}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">KYC: {t.user.kyc?.status ?? "UNVERIFIED"}</p>
            <Link href={`/admin/users?q=${encodeURIComponent(t.user.email)}`} className="mt-2 inline-block font-semibold text-accent-deep hover:underline">
              Find in Users →
            </Link>
          </section>

          {t.orderReference ? (
            <section className="admin-card p-5 text-sm">
              <h2 className="text-lg font-bold text-ink">About</h2>
              <p className="mt-2 font-mono text-ink">{t.orderReference}</p>
              <Link href={`/admin/users?q=${encodeURIComponent(t.orderReference)}`} className="mt-2 inline-block font-semibold text-accent-deep hover:underline">
                Look up this transaction →
              </Link>
            </section>
          ) : null}

          <section className="admin-card p-5 text-sm">
            <h2 className="text-lg font-bold text-ink">Handling</h2>
            <p className="mt-2 text-ink-soft">With: {t.assignedTo?.fullName ?? "nobody yet"}</p>
            {mayAct && isActive(t.status) ? (
              <ActionForm
                action={supportAssignAction}
                className="mt-2"
                submitLabel={t.assignedTo?.id === user.id ? "Hand back to the queue" : "Take this ticket"}
                submitVariant="ghost"
                resetOnSuccess={false}
              >
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="take" value={t.assignedTo?.id === user.id ? "0" : "1"} />
              </ActionForm>
            ) : null}
            {mayAct && moves.length > 0 ? (
              <ActionForm action={supportStatusAction} className="mt-4" submitLabel="Change status" submitVariant="dark" resetOnSuccess={false}>
                <input type="hidden" name="id" value={t.id} />
                <label className="block text-sm text-ink">
                  Move to
                  <select className="input mt-1" name="status" defaultValue={moves[0]}>
                    {moves.map((s) => (
                      <option key={s} value={s}>
                        {SUPPORT_STATUS_LABEL_STAFF[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </ActionForm>
            ) : null}
            {t.resolvedAt ? <p className="mt-3 text-xs text-[var(--muted)]">Resolved {formatLagosDateTime(t.resolvedAt)}</p> : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
