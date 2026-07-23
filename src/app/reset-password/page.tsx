import Link from "next/link";
import { redirect } from "next/navigation";
import { resetPasswordAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { SiteHeader } from "@/components/site-chrome";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");

  const { token } = await searchParams;
  if (!token?.trim()) {
    return (
      <>
        <SiteHeader />
        <main className="page-shell mx-auto max-w-md py-16">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">
            Invalid reset link
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            This link is missing a token. Request a new one from forgot password.
          </p>
          <Link href="/forgot-password" className="btn btn-primary mt-6 inline-flex">
            Request reset link
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <div className="auth-shell flex-1">
        <aside className="auth-brand">
          <p className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight">
            Nexora
          </p>
          <p className="mt-4 max-w-sm text-lg text-white/75">
            Choose a strong password. This signs you out of every other device.
          </p>
        </aside>
        <main className="flex flex-col justify-center px-4 py-12 sm:px-10">
          <div className="mx-auto w-full max-w-md">
            <p className="section-label">Account</p>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">
              Set new password
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              At least 10 characters, with upper, lower, and a number.
            </p>
            <ActionForm
              action={resetPasswordAction}
              className="panel mt-8"
              submitLabel="Update password"
            >
              <input type="hidden" name="token" value={token} />
              <label className="block text-sm font-medium">
                New password
                <input
                  className="input mt-1"
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                  required
                  minLength={10}
                />
              </label>
              <label className="mt-4 block text-sm font-medium">
                Confirm password
                <input
                  className="input mt-1"
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  required
                  minLength={10}
                />
              </label>
            </ActionForm>
            <p className="mt-4 text-center text-sm text-ink-soft">
              Ready?{" "}
              <Link href="/login" className="font-semibold text-accent-deep">
                Log in
              </Link>
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
