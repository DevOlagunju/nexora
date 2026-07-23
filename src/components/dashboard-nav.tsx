"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Overview", exact: true },
  { href: "/dashboard/orders", label: "Orders" },
  { href: "/dashboard/sell-crypto", label: "Sell crypto" },
  { href: "/dashboard/buy-crypto", label: "Buy crypto" },
  { href: "/dashboard/sell-giftcard", label: "Gift card" },
  { href: "/dashboard/kyc", label: "KYC" },
  { href: "/dashboard/settings", label: "Security" },
] as const;

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="dash-nav" aria-label="Dashboard">
      {LINKS.map((link) => {
        const active =
          "exact" in link && link.exact
            ? pathname === link.href
            : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
