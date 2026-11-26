import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { can, staffRoleLabel } from "@/lib/permissions";
import { pendingWork, pendingWorkIds } from "@/lib/services/admin-overview";
import { prisma } from "@/lib/db";
import { AdminSidebar, type AdminNavItem } from "@/components/admin/sidebar";
import { MenuIcon, SearchIcon } from "@/components/admin/icons";
import { NotificationsMenu } from "@/components/admin/notifications-menu";
import { AccountMenu } from "@/components/admin/account-menu";
import { Popover } from "@/components/admin/popover";
import { SectionJump, SectionLink } from "@/components/admin/section-link";
import pkg from "../../../../package.json";

/**
 * Admin console shell: dark green sidebar, search and account bar. Every admin page checks the
 * session and role itself as well; this only decides the chrome.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  const [pending, pendingIds, ticketsNeedingReply] = await Promise.all([
    pendingWork(8),
    pendingWorkIds(),
    prisma.supportTicket.count({ where: { status: "OPEN" } }),
  ]);
  const items: AdminNavItem[] = [
    { href: "/admin", label: "Dashboard", icon: "home" },
    { href: "/admin/users", label: "Users", icon: "users" },
    { href: "/admin/support", label: "Support", icon: "support", badge: ticketsNeedingReply },
    { href: "/admin/desk#approvals", label: "Approvals", icon: "approvals" },
    { href: "/admin/desk#kyc", label: "KYC", icon: "kyc" },
    { href: "/admin/desk#crypto", label: "Crypto Orders", icon: "crypto" },
    { href: "/admin/desk#gift", label: "Gift Cards", icon: "gift" },
    { href: "/admin/desk#deposits", label: "Deposits", icon: "deposits" },
    { href: "/admin/desk#withdrawals", label: "Payouts", icon: "payouts" },
    { href: "/admin/desk#rates", label: "Rates", icon: "rates" },
    { href: "/admin/desk#giftcard-rates", label: "Gift Card Rates", icon: "giftRates" },
    { href: "/admin/desk#wallets", label: "Assets & Networks", icon: "networks" },
    ...(can(user, "reports.view") ? [{ href: "/admin/desk#earnings", label: "Reports", icon: "reports" as const }] : []),
    ...(can(user, "staff.manage") || can(user, "audit.view") ? [{ href: "/admin/staff", label: "Staff", icon: "staff" as const }] : []),
    ...(can(user, "audit.view") ? [{ href: "/admin/audit", label: "Audit Trail", icon: "audit" as const }] : []),
  ];
  const initials = user.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="admin-shell">
      <div className="hidden lg:block">
        <AdminSidebar items={items} roleLabel={staffRoleLabel(user)} version={pkg.version} logout={logoutAction} />
      </div>

      <div className="min-w-0 flex-1">
        <header className="admin-topbar">
          {/* Small screens: the same links in a drop-down. */}
          <div className="lg:hidden">
            <Popover label="Menu" align="left" buttonClassName="admin-icon-btn" panelClassName="w-64" button={<MenuIcon />}>
              <nav className="rounded-2xl border border-[var(--line)] bg-white p-2 shadow-xl">
                {items.map((i) => (
                  <SectionLink key={i.href} href={i.href} className="block rounded-xl px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-soft">
                    {i.label}
                    {i.badge ? <span className="ml-2 text-xs text-[#7a5200]">({i.badge})</span> : null}
                  </SectionLink>
                ))}
              </nav>
            </Popover>
          </div>

          <form action="/admin/users" className="admin-search" role="search">
            <SearchIcon className="h-5 w-5 text-[var(--muted)]" />
            <input name="q" placeholder="Search users, orders, or references..." aria-label="Search users, orders or references" />
          </form>

          <div className="ml-auto flex items-center gap-4">
            <NotificationsMenu
              total={pending.total}
              ids={pendingIds}
              viewerId={user.id}
              items={pending.items.map((p) => ({
                id: `${p.kind}-${p.id}`,
                title: p.title,
                detail: p.detail,
                href: p.href,
                at: p.at.toISOString(),
                urgent: p.action === "Investigate",
              }))}
            />
            <div className="hidden h-8 w-px bg-[var(--line)] sm:block" />
            <AccountMenu name={user.fullName} email={user.email} role={staffRoleLabel(user)} initials={initials} logout={logoutAction} />
          </div>
        </header>

        <main className="admin-main">{children}</main>
        <SectionJump />
      </div>
    </div>
  );
}
