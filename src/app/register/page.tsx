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
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-12">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">Create your Nexora account</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Nigeria phone required. Strong password (10+ chars, upper, lower, number).
        </p>
        <ActionForm action={registerAction} className="card-panel mt-8" submitLabel="Create account">
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
      </main>
    </>
  );
}
