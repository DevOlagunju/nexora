import Link from "next/link";
import { redirect } from "next/navigation";
import { forgotPasswordAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { SiteHeader } from "@/components/site-chrome";

export default async function ForgotPasswordPage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");

  return (
    <>
      <SiteHeader />
      <div className="auth-shell flex-1">
        <aside className="auth-brand">
          <p className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight">
            Nexora
          </p>
          <p className="mt-4 max-w-sm text-lg text-white/75">
            Reset access safely - we email a one-hour link, never share codes in chat.
          </p>
        </aside>
        <main className="flex flex-col justify-center px-4 py-12 sm:px-10">
          <div className="mx-auto w-full max-w-md">
            <p className="section-label">Account</p>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">
              Forgot password
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              Enter your email and we&apos;ll send a reset link if that account exists.
            </p>
            <ActionForm
              action={forgotPasswordAction}
              className="panel mt-8"
              submitLabel="Send reset link"
            >
              <label className="block text-sm font-medium">
                Email
                <input
                  className="input mt-1"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                />
              </label>
            </ActionForm>
            <p className="mt-4 text-center text-sm text-ink-soft">
              Remembered it?{" "}
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
