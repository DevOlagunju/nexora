import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { SiteHeader } from "@/components/site-chrome";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : "/dashboard");

  return (
    <>
      <SiteHeader />
      <div className="auth-shell flex-1">
        <aside className="auth-brand">
          <p className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight">Nexora</p>
          <p className="mt-4 max-w-sm text-lg text-white/75">
            Crypto and gift cards to Naira - desk-verified, Nigeria-first.
          </p>
          <p className="mt-8 text-sm uppercase tracking-[0.18em] text-accent">Sell · Settle · Done</p>
        </aside>
        <main className="flex flex-col justify-center px-4 py-12 sm:px-10">
          <div className="mx-auto w-full max-w-md">
            <p className="section-label">Welcome back</p>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">Log in</h1>
            <p className="mt-2 text-sm text-ink-soft">Manage crypto and gift card orders.</p>
            <ActionForm action={loginAction} className="panel mt-8" submitLabel="Log in">
              <label className="block text-sm font-medium">
                Email
                <input className="input mt-1" name="email" type="email" required autoComplete="email" />
              </label>
              <label className="mt-4 block text-sm font-medium">
                Password
                <input
                  className="input mt-1"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </label>
            </ActionForm>
            <p className="mt-3 text-right text-sm">
              <Link href="/forgot-password" className="font-semibold text-accent-deep">
                Forgot password?
              </Link>
            </p>
            <p className="mt-4 text-center text-sm text-ink-soft">
              New here?{" "}
              <Link href="/register" className="font-semibold text-accent-deep">
                Create an account
              </Link>
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
