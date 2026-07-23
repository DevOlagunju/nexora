"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import type { ActionResult } from "@/app/actions";

export function ActionForm({
  action,
  children,
  className,
  onSuccess,
  submitLabel = "Submit",
  resetOnSuccess = true,
  submitVariant = "primary",
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  className?: string;
  onSuccess?: () => void;
  submitLabel?: string;
  /** Set false for edit forms (admin status updates) so fields keep submitted values until refresh. */
  resetOnSuccess?: boolean;
  submitVariant?: "primary" | "dark" | "ghost" | "danger";
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const btnClass =
    submitVariant === "dark"
      ? "btn btn-dark"
      : submitVariant === "ghost"
        ? "btn btn-ghost"
        : submitVariant === "danger"
          ? "btn btn-danger"
          : "btn btn-primary";

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
              if (resetOnSuccess) form.reset();
              router.refresh();
            } else {
              setError(res.error);
            }
          } catch (err) {
            if (isRedirectError(err)) throw err;
            setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
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
      <button type="submit" disabled={pending} className={`${btnClass} mt-4 w-full disabled:opacity-60`}>
        {pending ? "Please wait..." : submitLabel}
      </button>
    </form>
  );
}
