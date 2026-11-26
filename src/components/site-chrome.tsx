import Link from "next/link";
import { logoutAction } from "@/app/actions";
import type { SessionUser } from "@/lib/auth";
import { supportWhatsAppUrl } from "@/lib/support";
import { NexoraLogo } from "@/components/nexora-logo";
import { DownloadIcon, MenuIcon, WhatsAppIcon } from "@/components/landing/icons";
import { NavItem, SiteNav, type NavLink } from "@/components/site-nav";

/** Public-site navigation. Customers trade in the app, so there is no sign-in here: staff use /admin/login. */
function navigation() {
  const whatsapp = supportWhatsAppUrl("Hi Nexora, I have a question.");
  const support: NavLink[] = whatsapp ? [{ label: "WhatsApp support", href: whatsapp, external: true }] : [];
  return {
    features: [
      { label: "Today's rates", href: "/rates" },
      { label: "Payout calculator", href: "/#rates" },
      { label: "Why Nexora", href: "/#about" },
    ] as NavLink[],
    help: [{ label: "How it works", href: "/#how" }, { label: "FAQ", href: "/#faq" }, ...support] as NavLink[],
    contact: whatsapp ? ({ label: "Contact", href: whatsapp, external: true } as NavLink) : ({ label: "Contact", href: "/#faq" } as NavLink),
    whatsapp,
  };
}

export function SiteHeader({ user, current }: { user?: SessionUser | null; current?: "home" | "rates" }) {
  const nav = navigation();
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-white/75 backdrop-blur-md">
      <div className="site-wrap flex h-[4.75rem] items-center justify-between gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 font-[family-name:var(--font-display)] text-[1.7rem] font-bold tracking-tight text-ink">
          <NexoraLogo size={40} />
          Nexora
        </Link>

        <SiteNav
          current={current === "rates" ? "features" : current}
          features={nav.features}
          help={nav.help}
          contact={nav.contact}
        />

        <div className="flex items-center gap-2">
          {user?.role === "ADMIN" ? (
            <>
              <Link href="/admin" className="btn btn-dark hidden px-4 py-2 text-sm sm:inline-flex">
                Admin
              </Link>
              <form action={logoutAction} className="hidden lg:block">
                <button type="submit" className="btn btn-ghost px-3 py-2 text-sm">
                  Log out
                </button>
              </form>
            </>
          ) : null}
          <Link href="/#get-app" className="download-pill">
            <span className="hidden sm:inline">Download the App</span>
            <span className="sm:hidden">Get the app</span>
            <DownloadIcon className="h-[18px] w-[18px]" />
          </Link>

          <details className="relative lg:hidden">
            <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--line)] bg-white text-ink marker:content-none">
              <MenuIcon className="h-5 w-5" />
              <span className="sr-only">Menu</span>
            </summary>
            <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-[var(--line)] bg-white p-2 shadow-[0_18px_40px_rgba(10,79,42,0.16)]">
              {[{ label: "Home", href: "/" }, { label: "About", href: "/#about" }, ...nav.features, ...nav.help, nav.contact].map((l) => (
                <NavItem
                  key={l.label}
                  link={l}
                  className="block rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-ink-soft hover:bg-accent-soft hover:text-accent-deep"
                />
              ))}
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const nav = navigation();
  const links: NavLink[] = [
    { label: "About", href: "/#about" },
    { label: "Rates", href: "/rates" },
    { label: "Help", href: "/#faq" },
    nav.contact,
  ];
  return (
    <footer className="mt-auto bg-[#0b2418] text-white">
      <div className="site-wrap">
        <div className="flex flex-col items-center gap-6 py-7 md:flex-row md:justify-between">
          <Link href="/" className="flex items-center gap-2.5 font-[family-name:var(--font-display)] text-2xl font-bold">
            <NexoraLogo size={38} />
            Nexora
          </Link>
          <nav className="flex flex-wrap justify-center gap-x-10 gap-y-2 text-[15px] text-white/85" aria-label="Footer">
            {links.map((l) => (
              <NavItem key={l.label} link={l} className="hover:text-accent-bright" />
            ))}
          </nav>
          {nav.whatsapp ? (
            <a
              href={nav.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-[15px] text-white/85 hover:text-accent-bright"
            >
              <WhatsAppIcon className="h-5 w-5" /> Chat with us
            </a>
          ) : (
            <span className="hidden md:block" />
          )}
        </div>
        <div className="flex flex-col items-center justify-between gap-2 border-t border-white/10 py-5 text-sm md:flex-row">
          <p className="text-white/70">© {new Date().getFullYear()} Nexora. All rights reserved.</p>
          <p className="text-white/90">
            Trade Smarter. Live <span className="swoosh-underline">Better.</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
