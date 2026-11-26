"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

/**
 * Links to a #section of an admin page.
 *
 * Next.js 16 mishandles #hashes on client navigation here: it appends the new hash to the one the
 * page was last seen with (/admin/desk#approvals#crypto), which breaks the address, the scroll and
 * the sidebar highlight. So:
 *   - same page: the browser jumps to the section itself (scrolls, fires hashchange);
 *   - another page: Next.js opens the page without a hash, then <SectionJump /> sets the hash once
 *     it has rendered.
 * Links without a #hash behave exactly like next/link.
 */

let pending: { path: string; hash: string } | null = null;

export function SectionLink({
  href,
  onClick,
  ...rest
}: Omit<React.ComponentProps<typeof Link>, "href"> & { href: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        const [path, hash] = href.split("#");
        if (hash === undefined) return;
        e.preventDefault();
        if (path === window.location.pathname) {
          window.location.hash = hash;
        } else {
          pending = { path, hash };
          router.push(path);
        }
      }}
    />
  );
}

/** Mounted once in the admin layout: finishes a cross-page jump to a #section. */
export function SectionJump() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pending || pending.path !== pathname) return;
    const { hash } = pending;
    pending = null;
    // Let the new page paint first, so the browser can find the section to scroll to.
    requestAnimationFrame(() => {
      window.location.hash = hash;
    });
  }, [pathname]);
  return null;
}
