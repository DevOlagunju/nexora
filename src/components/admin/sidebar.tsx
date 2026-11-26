"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NexoraLogo } from "@/components/nexora-logo";
import { SectionLink } from "@/components/admin/section-link";
import {
  BankIcon,
  ChartIcon,
  CheckSquareIcon,
  CoinsIcon,
  DownloadIcon,
  GiftIcon,
  HomeIcon,
  IdCardIcon,
  LayersIcon,
  LogoutIcon,
  ShieldIcon,
  TagIcon,
  TrendIcon,
  UsersIcon,
} from "@/components/admin/icons";

export type AdminNavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

const ICONS = {
  home: HomeIcon,
  users: UsersIcon,
  approvals: CheckSquareIcon,
  kyc: IdCardIcon,
  crypto: CoinsIcon,
  gift: GiftIcon,
  deposits: DownloadIcon,
  payouts: BankIcon,
  rates: TrendIcon,
  giftRates: TagIcon,
  networks: LayersIcon,
  reports: ChartIcon,
};

/**
 * Which item is current: the page, and for the desk also its #section.
 *
 * Next.js links change the address with history.pushState, which fires no event, and patching
 * pushState interferes with Next's own router. So: a click on a sidebar item sets the section
 * at once, and the address is re-read a few times a second (cheap: one string compare) so links
 * elsewhere (the bell, "Review", "View All") and back/forward are followed too.
 */
function useCurrent() {
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    update();
    const timer = window.setInterval(update, 250);
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, [pathname]);
  const isCurrent = (href: string) => {
    const [path, section] = href.split("#");
    if (path !== pathname) return false;
    return section ? hash === `#${section}` : !hash || pathname !== "/admin/desk";
  };
  const select = (href: string) => {
    const section = href.split("#")[1];
    setHash(section ? `#${section}` : "");
  };
  return { isCurrent, select };
}

export function AdminSidebar({
  items,
  roleLabel,
  version,
  logout,
}: {
  items: AdminNavItem[];
  roleLabel: string;
  version: string;
  logout: () => Promise<void>;
}) {
  const { isCurrent, select } = useCurrent();
  return (
    <aside className="admin-sidebar">
      <Link href="/admin" className="flex items-center gap-2.5 px-3 pb-6 pt-1">
        <NexoraLogo size={34} />
        <span className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-white">Nexora</span>
      </Link>

      <nav className="admin-sidebar-nav flex flex-1 flex-col gap-0.5" aria-label="Admin">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const on = isCurrent(item.href);
          return (
            <SectionLink
              key={item.href}
              href={item.href}
              onClick={() => select(item.href)}
              className={`admin-nav-link ${on ? "admin-nav-link--on" : ""}`}
              aria-current={on ? "page" : undefined}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge ? <span className="admin-nav-badge">{item.badge > 99 ? "99+" : item.badge}</span> : null}
            </SectionLink>
          );
        })}
      </nav>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-3">
          <ShieldIcon className="h-7 w-7 text-gold" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">{roleLabel}</p>
            <p className="text-xs text-white/55">Nexora desk v{version}</p>
          </div>
        </div>
      </div>

      <form action={logout} className="mt-3">
        <button type="submit" className="admin-nav-link w-full">
          <LogoutIcon className="h-5 w-5" />
          <span>Log out</span>
        </button>
      </form>
    </aside>
  );
}
