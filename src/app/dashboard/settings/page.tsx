import { redirect } from "next/navigation";
import {
  changePasswordAction,
  logoutAllSessionsAction,
} from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-xl">
      <p className="section-label">Account</p>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">
        Security
      </h1>
      <p className="mt-2 text-sm text-ink-soft">
        Update your password or sign out of every device. Signed in as{" "}
        <span className="font-medium text-ink">{user.email}</span>.
      </p>

      <ActionForm
        action={changePasswordAction}
        className="panel mt-6"
        submitLabel="Update password"
        resetOnSuccess
      >
        <p className="text-[15px] font-extrabold tracking-tight text-ink">Change password</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          At least 10 characters, with upper, lower, and a number. Other sessions are signed out.
        </p>
        <label className="mt-4 block text-sm font-medium">
          Current password
          <input
            className="input mt-1"
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
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
          Confirm new password
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

      <div className="panel mt-6">
        <p className="text-[15px] font-extrabold tracking-tight text-ink">Sessions</p>
        <p className="mt-1 text-sm text-ink-soft">
          Sign out everywhere if you lost a phone or shared a computer. You will need to log in
          again on this device too.
        </p>
        <ActionForm
          action={logoutAllSessionsAction}
          className="mt-2"
          submitLabel="Log out all sessions"
          submitVariant="danger"
          resetOnSuccess={false}
        />
      </div>
    </div>
  );
}
