import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { DashboardNav } from "@/components/dashboard-nav";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { unreadNotificationCount } from "@/lib/services/notifications";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const unread = await unreadNotificationCount(user.id);

  return (
    <>
      <SiteHeader user={user} />
      <div className="page-shell max-w-6xl py-8">
        <DashboardNav unread={unread} />
        {children}
      </div>
      <SiteFooter />
    </>
  );
}
