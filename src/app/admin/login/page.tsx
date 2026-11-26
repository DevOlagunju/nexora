import Link from "next/link";
import { redirect } from "next/navigation";
import { staffLoginAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { NexoraLogo } from "@/components/nexora-logo";
import { ShieldIcon } from "@/components/admin/icons";

export const metadata = { title: "Staff sign in · Nexora", robots: { index: false, follow: false } };

/** Staff sign-in for the admin console. Not linked from the public website. */
export default async function StaffLoginPage() {
  const user = await getSessionUser();
  if (user?.role === "ADMIN") redirect("/admin");

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      {/* Inline radius/padding: .admin-promo (a card style) would otherwise round and tighten this full-height panel. */}
      <aside className="admin-promo relative hidden flex-col justify-between lg:flex" style={{ borderRadius: 0, padding: "3rem" }}>
        <div className="flex items-center gap-3">
          <NexoraLogo size={44} />
          <span className="font-[family-name:var(--font-display)] text-3xl font-bold">Nexora</span>
        </div>
        <div>
          <p className="font-[family-name:var(--font-display)] text-4xl font-bold leading-tight">Staff console</p>
          <p className="mt-3 max-w-sm text-white/75">
            Rates, KYC, orders, deposits and payouts. Every action is checked against your role and logged.
          </p>
        </div>
        <p className="flex items-center gap-2 text-sm text-white/70">
          <ShieldIcon className="h-5 w-5 text-accent-bright" /> Sensitive changes need a second person to approve.
        </p>
      </aside>

      <main className="flex flex-col justify-center bg-[#f4f8f5] px-5 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <NexoraLogo size={36} />
            <span className="font-[family-name:var(--font-display)] text-2xl font-bold">Nexora</span>
          </div>
          <p className="section-label">Nexora staff</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">Sign in to the console</h1>
          <p className="mt-2 text-sm text-ink-soft">For desk, finance, compliance and support staff only.</p>

          <ActionForm action={staffLoginAction} className="admin-card mt-8 p-6" submitLabel="Sign in">
            <label className="block text-sm font-medium">
              Work email
              <input className="input mt-1" name="email" type="email" required autoComplete="username" />
            </label>
            <label className="mt-4 block text-sm font-medium">
              Password
              <input className="input mt-1" name="password" type="password" required autoComplete="current-password" />
            </label>
          </ActionForm>
          <p className="mt-3 text-right text-sm">
            <Link href="/forgot-password" className="font-semibold text-accent-deep">
              Forgot password?
            </Link>
          </p>
          <p className="mt-8 text-center text-xs text-[var(--muted)]">
            Not staff? Nexora is used through the app.{" "}
            <Link href="/#get-app" className="font-semibold text-accent-deep">
              Get the app
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
