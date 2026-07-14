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
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-12">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">Welcome back</h1>
        <p className="mt-2 text-sm text-ink-soft">Log in to manage crypto and gift card sells.</p>
        <ActionForm action={loginAction} className="card-panel mt-8" submitLabel="Log in">
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
        <p className="mt-4 text-center text-sm text-ink-soft">
          New here?{" "}
          <Link href="/register" className="font-semibold text-accent-deep">
            Create an account
          </Link>
        </p>
      </main>
    </>
  );
}
