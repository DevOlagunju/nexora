"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/landing/icons";

export type NavLink = { label: string; href: string; external?: boolean };
export type NavKey = "home" | "about" | "features" | "help" | "contact";

/** Home-page sections and the menu item each one belongs to, in page order. */
const SECTIONS: [id: string, key: NavKey][] = [
  ["about", "about"],
  ["rates", "features"],
  ["how", "help"],
  ["faq", "help"],
];

/** A section counts as "current" once its top passes this share of the viewport height. */
const SPY_LINE = 0.35;

export function NavItem({ link, className, onClick }: { link: NavLink; className: string; onClick?: () => void }) {
  return link.external ? (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
      {link.label}
    </a>
  ) : (
    <Link href={link.href} className={className} onClick={onClick}>
      {link.label}
    </Link>
  );
}

/** Which menu item an internal link belongs to, so clicking it moves the underline straight away. */
function keyForHref(href: string, fallback: NavKey): NavKey {
  const id = href.split("#")[1];
  if (id) return SECTIONS.find(([s]) => s === id)?.[1] ?? fallback;
  return href === "/" ? "home" : fallback;
}

/**
 * The desktop menu. One green underline slides to the current item: on the home page it follows
 * the section you are reading (and jumps straight to whatever you click); on other pages it marks
 * the page's own item.
 */
export function SiteNav({
  current,
  features,
  help,
  contact,
}: {
  current?: NavKey;
  features: NavLink[];
  help: NavLink[];
  contact: NavLink;
}) {
  const spy = current === "home";
  const [active, setActive] = useState<NavKey | undefined>(current);
  const navRef = useRef<HTMLElement>(null);
  const items = useRef(new Map<NavKey, HTMLElement>());
  const barRef = useRef<HTMLSpanElement>(null);
  // While a clicked link scrolls the page, ignore the sections it passes on the way.
  const lockedUntil = useRef(0);

  const register = useCallback(
    (key: NavKey) => (el: HTMLElement | null) => {
      if (el) items.current.set(key, el);
      else items.current.delete(key);
    },
    [],
  );

  const choose = useCallback((key: NavKey) => {
    lockedUntil.current = Date.now() + 1200;
    setActive(key);
  }, []);

  // Scroll spy (home page only).
  useEffect(() => {
    if (!spy) return;
    const update = () => {
      if (Date.now() < lockedUntil.current) return;
      const line = window.innerHeight * SPY_LINE;
      let next: NavKey = "home";
      for (const [id, key] of SECTIONS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) next = key;
      }
      setActive(next);
    };
    const unlock = () => {
      lockedUntil.current = 0;
      update();
    };
    // First check after paint, so a page opened at /#faq starts on the right item.
    const first = requestAnimationFrame(update);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("scrollend", unlock);
    window.addEventListener("hashchange", update);
    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("scroll", update);
      window.removeEventListener("scrollend", unlock);
      window.removeEventListener("hashchange", update);
    };
  }, [spy]);

  // Place the underline under the active item; re-measure when the layout changes (fonts, resize).
  useLayoutEffect(() => {
    const nav = navRef.current;
    const bar = barRef.current;
    if (!nav || !bar) return;
    const measure = () => {
      const el = active ? items.current.get(active) : undefined;
      if (!el) {
        bar.style.opacity = "0";
        return;
      }
      const n = nav.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      // The first placement snaps; later ones slide (the transition is enabled once placed).
      bar.style.transform = `translate(${r.left - n.left}px, ${r.bottom - n.top - 4}px)`;
      bar.style.width = `${r.width}px`;
      bar.style.opacity = "1";
      if (!bar.dataset.placed) requestAnimationFrame(() => (bar.dataset.placed = "1"));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [active]);

  const cls = (key: NavKey) => `site-nav-link${active === key ? " site-nav-link--on" : ""}`;

  return (
    <nav ref={navRef} className="relative hidden items-center gap-10 lg:flex" aria-label="Main">
      <Link href="/" ref={register("home")} className={cls("home")} onClick={() => choose("home")}>
        Home
      </Link>
      <Link href="/#about" ref={register("about")} className={cls("about")} onClick={() => choose("about")}>
        About
      </Link>
      <NavMenu label="Features" links={features} className={cls("features")} anchor={register("features")} onPick={choose} navKey="features" />
      <NavMenu label="Help" links={help} className={cls("help")} anchor={register("help")} onPick={choose} navKey="help" />
      <span ref={register("contact")} className="flex">
        <NavItem link={contact} className={cls("contact")} onClick={() => choose(keyForHref(contact.href, "contact"))} />
      </span>
      <span ref={barRef} aria-hidden="true" className="site-nav-bar" />
    </nav>
  );
}

/** A hover / keyboard-focus dropdown (opens with CSS; script only moves the underline). */
function NavMenu({
  label,
  links,
  className,
  anchor,
  onPick,
  navKey,
}: {
  label: string;
  links: NavLink[];
  className: string;
  anchor: (el: HTMLElement | null) => void;
  onPick: (key: NavKey) => void;
  navKey: NavKey;
}) {
  return (
    <div className="group relative">
      <button ref={anchor} type="button" className={`${className} flex items-center gap-1`} aria-haspopup="true">
        {label}
        <ChevronDownIcon className="h-4 w-4 opacity-70 transition [&_path]:[stroke-width:1.75] group-hover:rotate-180 group-focus-within:rotate-180" />
      </button>
      <div className="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-3 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <div className="min-w-52 rounded-2xl border border-[var(--line)] bg-white p-2 shadow-[0_18px_40px_rgba(10,79,42,0.14)]">
          {links.map((l) => (
            <NavItem
              key={l.label}
              link={l}
              onClick={() => onPick(keyForHref(l.href, navKey))}
              className="block rounded-xl px-3.5 py-2.5 text-[15px] font-medium text-ink-soft hover:bg-accent-soft hover:text-accent-deep"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
