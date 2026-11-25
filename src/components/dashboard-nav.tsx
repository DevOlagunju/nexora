"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/wallet", label: "Wallet" },
  { href: "/dashboard/orders", label: "Orders" },
  { href: "/dashboard/sell-crypto", label: "Sell crypto" },
  { href: "/dashboard/buy-crypto", label: "Buy crypto" },
  { href: "/dashboard/sell-giftcard", label: "Gift card" },
  { href: "/dashboard/alerts", label: "Rate alerts" },
  { href: "/dashboard/referrals", label: "Rewards" },
  { href: "/dashboard/kyc", label: "KYC" },
  { href: "/dashboard/settings", label: "Security" },
] as const;

export function DashboardNav({ unread = 0 }: { unread?: number }) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="dash-nav" aria-label="Dashboard">
      {LINKS.map((link) => {
        const active = isActive(link.href, "exact" in link && link.exact);
        return (
          <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
      <Link
        href="/dashboard/notifications"
        aria-current={isActive("/dashboard/notifications") ? "page" : undefined}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="ml-auto inline-flex items-center gap-1.5"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span className="hidden sm:inline">Inbox</span>
        {unread > 0 && <span className="notif-dot">{unread > 99 ? "99+" : unread}</span>}
      </Link>
    </nav>
  );
}
