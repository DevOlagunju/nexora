"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A button that opens a panel below it. Closes on an outside click, on Escape, when a link inside
 * is followed, and when the page changes.
 */
export function Popover({
  label,
  button,
  children,
  align = "right",
  buttonClassName = "",
  panelClassName = "",
}: {
  label: string;
  button: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  buttonClassName?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const search = useSearchParams();

  // Close when the page changes (state adjusted during render, as React recommends over an effect).
  const routeKey = `${pathname}?${search.toString()}`;
  const [seenRoute, setSeenRoute] = useState(routeKey);
  if (seenRoute !== routeKey) {
    setSeenRoute(routeKey);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className={buttonClassName}
      >
        {button}
      </button>
      {open ? (
        <div
          className={`absolute top-full z-50 mt-2 ${align === "right" ? "right-0" : "left-0"} ${panelClassName}`}
          // A link inside was followed: close (the same page with a new #hash doesn't change the path).
          onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
