"use client";

import Link from "next/link";
import { Popover } from "@/components/admin/popover";
import { HomeIcon, LogoutIcon, ShieldIcon } from "@/components/admin/icons";

/** The name in the top bar: who is signed in, and the way out. */
export function AccountMenu({
  name,
  email,
  role,
  initials,
  logout,
}: {
  name: string;
  email: string;
  role: string;
  initials: string;
  logout: () => Promise<void>;
}) {
  return (
    <Popover
      label={`Account menu for ${name}`}
      buttonClassName="flex items-center gap-3 rounded-full py-1 pl-1 pr-2 text-left transition hover:bg-accent-soft"
      panelClassName="w-64"
      button={
        <>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-sm font-bold text-accent-deep ring-2 ring-accent/40">
            {initials || "A"}
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-bold text-ink">{name.split(/\s+/)[0]}</span>
            <span className="block text-xs text-[var(--muted)]">{role}</span>
          </span>
          <svg viewBox="0 0 24 24" className="hidden h-4 w-4 text-ink-soft sm:block" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </>
      }
    >
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-2xl">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <p className="truncate font-bold text-ink">{name}</p>
          <p className="truncate text-xs text-ink-soft">{email}</p>
          <p className="mt-1 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold text-accent-deep">{role}</p>
        </div>
        <nav className="p-1.5">
          <Link href="/dashboard/settings" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink hover:bg-paper">
            <ShieldIcon className="h-4 w-4 text-ink-soft" /> Password &amp; security
          </Link>
          <Link href="/" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink hover:bg-paper">
            <HomeIcon className="h-4 w-4 text-ink-soft" /> Open the website
          </Link>
        </nav>
        <form action={logout} className="border-t border-[var(--line)] p-1.5">
          <button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold text-danger hover:bg-[#fdecec]">
            <LogoutIcon className="h-4 w-4" /> Log out
          </button>
        </form>
      </div>
    </Popover>
  );
}
