"use client";

import { useState } from "react";

/** Copies a value (deposit address / account number) with inline confirmation. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard blocked: value is still selectable on screen */
        }
      }}
      className="shrink-0 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-xs font-bold text-ink-soft transition hover:border-accent hover:text-accent-deep"
      aria-live="polite"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
