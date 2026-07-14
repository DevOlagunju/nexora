import Link from "next/link";
import { logoutAction } from "@/app/actions";
import type { SessionUser } from "@/lib/auth";

export function SiteHeader({ user }: { user?: SessionUser | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--paper)_88%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-[family-name:var(--font-display)] text-xl font-bold tracking-tight text-ink">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-sm text-accent">N</span>
          Nexora
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-ink-soft md:flex">
          <a href="/rates" className="hover:text-ink">
            Rates
          </a>
          <a href="/#live-market" className="hover:text-ink">
            Live market
          </a>
          <a href="/#how" className="hover:text-ink">
            How it works
          </a>
          <a href="/#faq" className="hover:text-ink">
            FAQ
          </a>
          {user ? (
            <>
              <Link href="/dashboard" className="hover:text-ink">
                Dashboard
              </Link>
              {user.role === "ADMIN" && (
                <Link href="/admin" className="hover:text-ink">
                  Admin
                </Link>
              )}
              <form action={logoutAction}>
                <button type="submit" className="btn btn-ghost px-3 py-2 text-sm">
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="hover:text-ink">
                Log in
              </Link>
              <Link href="/register" className="btn btn-primary px-4 py-2 text-sm">
                Start trading
              </Link>
            </>
          )}
        </nav>
        <div className="flex items-center gap-2 md:hidden">
          {user ? (
            <Link href="/dashboard" className="btn btn-dark px-3 py-2 text-sm">
              App
            </Link>
          ) : (
            <Link href="/register" className="btn btn-primary px-3 py-2 text-sm">
              Trade
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--line)] bg-ink px-4 py-6 text-center text-sm text-white/60">
      © {new Date().getFullYear()} Nexora
    </footer>
  );
}
