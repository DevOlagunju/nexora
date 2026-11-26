import Link from "next/link";
import { logoutAction } from "@/app/actions";
import type { SessionUser } from "@/lib/auth";
import { NexoraLogo } from "@/components/nexora-logo";

export function SiteHeader({ user }: { user?: SessionUser | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--paper)_88%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-[family-name:var(--font-display)] text-xl font-bold tracking-tight text-ink"
        >
          <NexoraLogo size={30} />
          Nexora
        </Link>
        {/* Customers trade in the app, so the site has no sign-in: staff use /admin. */}
        <nav className="hidden items-center gap-6 text-sm text-ink-soft md:flex">
          <Link href="/rates" className="hover:text-ink">
            Rates
          </Link>
          <Link href="/#how" className="hover:text-ink">
            How it works
          </Link>
          <Link href="/#faq" className="hover:text-ink">
            FAQ
          </Link>
          {user?.role === "ADMIN" ? (
            <>
              <Link href="/admin" className="hover:text-ink">
                Admin
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="btn btn-ghost px-3 py-2 text-sm">
                  Log out
                </button>
              </form>
            </>
          ) : null}
          <Link href="/#get-app" className="btn btn-primary px-4 py-2 text-sm">
            Get the app
          </Link>
        </nav>
        <div className="flex items-center gap-2 md:hidden">
          {user?.role === "ADMIN" ? (
            <Link href="/admin" className="btn btn-dark px-3 py-2 text-sm">
              Admin
            </Link>
          ) : null}
          <Link href="/#get-app" className="btn btn-primary px-3 py-2 text-sm">
            Get the app
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--line)] bg-forest px-4 py-8 text-center text-sm text-white/60">
      <p>© {new Date().getFullYear()} Nexora. All rights reserved.</p>
    </footer>
  );
}
