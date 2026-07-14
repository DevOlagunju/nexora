"use client";

import { useState, useTransition } from "react";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import type { ActionResult } from "@/app/actions";

export function ActionForm({
  action,
  children,
  className,
  onSuccess,
  submitLabel = "Submit",
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  onSuccess?: () => void;
  submitLabel?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        setError(null);
        setMessage(null);
        start(async () => {
          try {
            const res = await action(fd);
            if (res.ok) {
              setMessage(res.message ?? "Done.");
              onSuccess?.();
              form.reset();
            } else {
              setError(res.error);
            }
          } catch (err) {
            if (isRedirectError(err)) throw err;
            setError("Something went wrong. Please try again.");
          }
        });
      }}
    >
      {children}
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-accent-deep" role="status">
          {message}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary mt-4 w-full disabled:opacity-60">
        {pending ? "Please wait…" : submitLabel}
      </button>
    </form>
  );
}
