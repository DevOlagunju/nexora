"use client";

import { useEffect, useSyncExternalStore } from "react";

const KEY = "nexora.hideBalance";
const EVENT = "nexora:hide-balance";

function read() {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage blocked: default to visible
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/**
 * Eye toggle that blurs every `.money-private` amount on the page (shoulder-surfing protection,
 * standard in Nigerian banking apps). Preference is per device.
 */
export function BalanceToggle({ className = "" }: { className?: string }) {
  const hidden = useSyncExternalStore(subscribe, read, () => false);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-hide-balance", hidden);
  }, [hidden]);

  const toggle = () => {
    try {
      window.localStorage.setItem(KEY, hidden ? "0" : "1");
    } catch {
      document.documentElement.toggleAttribute("data-hide-balance", !hidden);
    }
    window.dispatchEvent(new Event(EVENT));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={hidden ? "Show balances" : "Hide balances"}
      title={hidden ? "Show balances" : "Hide balances"}
      className={`inline-grid size-8 place-items-center rounded-full transition hover:bg-white/15 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        {hidden ? (
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61M2 2l20 20" />
        ) : (
          <>
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  );
}
