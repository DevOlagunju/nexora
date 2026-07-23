import Link from "next/link";
import { redirect } from "next/navigation";
import { registerAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { SiteHeader } from "@/components/site-chrome";

export default async function RegisterPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <>
      <SiteHeader />
      <div className="auth-shell flex-1">
        <aside className="auth-brand">
          <p className="font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight">Nexora</p>
          <p className="mt-4 max-w-sm text-lg text-white/75">
            Create one account for web and mobile. Verify once, then trade.
          </p>
          <p className="mt-8 text-sm uppercase tracking-[0.18em] text-accent">Nigeria-first desk</p>
        </aside>
        <main className="flex flex-col justify-center px-4 py-12 sm:px-10">
          <div className="mx-auto w-full max-w-md">
            <p className="section-label">Get started</p>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">
              Create account
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              Nigeria phone required. Strong password (10+ chars, upper, lower, number).
            </p>
            <ActionForm action={registerAction} className="panel mt-8" submitLabel="Create account">
              <label className="block text-sm font-medium">
                Full name
                <input className="input mt-1" name="fullName" required autoComplete="name" />
              </label>
              <label className="mt-4 block text-sm font-medium">
                Email
                <input className="input mt-1" name="email" type="email" required autoComplete="email" />
              </label>
              <label className="mt-4 block text-sm font-medium">
                Phone (e.g. 08012345678)
                <input className="input mt-1" name="phone" required autoComplete="tel" />
              </label>
              <label className="mt-4 block text-sm font-medium">
                Password
                <input
                  className="input mt-1"
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              </label>
            </ActionForm>
            <p className="mt-4 text-center text-sm text-ink-soft">
              Already have an account?{" "}
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
