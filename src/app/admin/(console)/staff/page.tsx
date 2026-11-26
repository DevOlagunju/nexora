import { SectionLink as Link } from "@/components/admin/section-link";
import { redirect } from "next/navigation";
import { requestStaffRoleChangeAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, denialMessage, PERMISSIONS, permissionsOf, STAFF_ROLE_LABEL, type Permission } from "@/lib/permissions";
import { accessLabel } from "@/lib/staff-rules";
import { ago } from "@/lib/admin-overview-rules";
import { ActionForm } from "@/components/action-form";
import type { StaffRole } from "@/generated/prisma/enums";

export const metadata = { title: "Staff · Nexora admin" };

const ROLES = Object.keys(STAFF_ROLE_LABEL) as StaffRole[];
const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/**
 * Who has staff access and what each role may do. Super Admins can ask to give, change or remove
 * access; it only takes effect when a different Super Admin approves it (desk → Approvals).
 */
export default async function AdminStaffPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  const mayManage = can(user, "staff.manage");
  if (!mayManage && !can(user, "audit.view")) {
    return (
      <div className="mx-auto max-w-[96rem]">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-ink">Staff</h1>
        <p className="admin-card mt-6 p-5 text-sm text-ink-soft">{denialMessage(user, "staff.manage")}</p>
      </div>
    );
  }

  const [staff, pending] = await Promise.all([
    prisma.user.findMany({
      where: { role: "ADMIN" },
      orderBy: [{ staffRole: "asc" }, { fullName: "asc" }],
      select: { id: true, fullName: true, email: true, role: true, staffRole: true, createdAt: true },
    }),
    prisma.approvalRequest.findMany({
      where: { action: "staff.role_change", status: "PENDING" },
      orderBy: { requestedAt: "asc" },
      include: { requestedBy: { select: { fullName: true } } },
    }),
  ]);
  const superAdmins = staff.filter((s) => s.staffRole === "SUPER_ADMIN").length;

  return (
    <div className="mx-auto max-w-[96rem]">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-ink">Staff</h1>
        <p className="mt-1 max-w-3xl text-ink-soft">
          Who can use the desk and what their role allows. Changes need two Super Admins: one asks, a different one approves
          under <Link href="/admin/desk#approvals" className="font-semibold text-accent-deep hover:underline">Approvals</Link>.
        </p>
      </div>

      {superAdmins < 2 ? (
        <p className="mt-5 rounded-2xl border border-[#f1d58a] bg-[#fff8e6] p-4 text-sm text-[#7a5200]">
          There {superAdmins === 1 ? "is only one Super Admin" : "are no Super Admins"}, so nobody can approve a staff change here. Add a
          second one with <code className="font-mono">npm run admin:role -- email SUPER_ADMIN</code> on the server.
        </p>
      ) : null}

      {pending.length > 0 ? (
        <section className="admin-card mt-5 p-5">
          <h2 className="text-lg font-bold text-ink">Waiting for approval</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-ink">{r.summary}</span>
                <span className="text-xs text-[var(--muted)]">
                  asked by {r.requestedBy.fullName} · {ago(r.requestedAt)} ·{" "}
                  <Link href="/admin/desk#approvals" className="font-semibold text-accent-deep hover:underline">
                    review
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <section className="admin-card p-5">
          <h2 className="text-lg font-bold text-ink">People with staff access ({staff.length})</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-[var(--muted)]">
                  <th className="pb-2 pr-4 font-semibold">Person</th>
                  <th className="pb-2 pr-4 font-semibold">Role</th>
                  <th className="pb-2 pr-4 font-semibold">Can</th>
                  <th className="pb-2 text-right font-semibold">Account created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)] align-top">
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td className="py-3 pr-4">
                      <p className="font-semibold text-ink">
                        {s.fullName}
                        {s.id === user.id ? <span className="ml-1.5 text-xs font-normal text-[var(--muted)]">(you)</span> : null}
                      </p>
                      <p className="text-xs text-ink-soft">{s.email}</p>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 font-semibold text-ink">{accessLabel(s)}</td>
                    <td className="py-3 pr-4 text-xs text-ink-soft">
                      {permissionsOf(s)
                        .map((p) => PERMISSIONS[p])
                        .join(", ")}
                    </td>
                    <td className="whitespace-nowrap py-3 text-right text-xs text-[var(--muted)]">{ago(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {mayManage ? (
          <ActionForm action={requestStaffRoleChangeAction} className="admin-card p-5" submitLabel="Ask for approval">
            <h2 className="text-lg font-bold text-ink">Give, change or remove access</h2>
            <p className="mt-1 text-xs text-ink-soft">
              The person needs an account first (they can sign up in the app). An account that has traded or holds money can&apos;t
              become staff: staff use a separate account. Removing access signs them out everywhere.
            </p>
            <label className="mt-4 block text-sm">
              Email
              <input className="input mt-1" name="email" type="email" required placeholder="person@example.com" autoComplete="off" />
            </label>
            <label className="mt-3 block text-sm">
              Role
              <select className="input mt-1" name="role" defaultValue="CUSTOMER_SUPPORT">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {STAFF_ROLE_LABEL[r]}
                  </option>
                ))}
                <option value="NONE">No staff access (remove)</option>
              </select>
            </label>
            <label className="mt-3 block text-sm">
              Why
              <input className="input mt-1" name="note" required minLength={10} maxLength={500} placeholder="e.g. Joined the finance team" />
            </label>
          </ActionForm>
        ) : null}
      </div>

      <section className="admin-card mt-5 p-5">
        <h2 className="text-lg font-bold text-ink">What each role can do</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[var(--muted)]">
                <th className="pb-2 pr-3 font-semibold">Permission</th>
                {ROLES.map((r) => (
                  <th key={r} className="pb-2 pr-3 text-center font-semibold">
                    {STAFF_ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {ALL_PERMISSIONS.map((p) => (
                <tr key={p}>
                  <td className="py-2 pr-3 font-medium text-ink">{PERMISSIONS[p]}</td>
                  {ROLES.map((r) => {
                    const yes = can({ role: "ADMIN", staffRole: r }, p);
                    return (
                      <td key={r} className={`py-2 pr-3 text-center ${yes ? "font-bold text-accent" : "text-[var(--muted)]"}`} aria-label={yes ? "yes" : "no"}>
                        {yes ? "✓" : "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
