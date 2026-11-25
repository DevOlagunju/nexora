import { redirect } from "next/navigation";
import {
  changePasswordAction,
  logoutAllSessionsAction,
  setTransactionPinAction,
} from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ActionForm } from "@/components/action-form";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { transactionPinHash: true } });
  const hasPin = !!me?.transactionPinHash;

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

      <ActionForm
        action={setTransactionPinAction}
        className="panel mt-6 scroll-mt-24"
        submitLabel={hasPin ? "Change PIN" : "Set PIN"}
        resetOnSuccess
      >
        <p id="pin" className="text-[15px] font-extrabold tracking-tight text-ink">
          Transaction PIN{" "}
          {hasPin && <span className="status-pill status-success ml-2 align-middle">Active</span>}
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          4 digits, needed for every withdrawal. Avoid 1234, 0000 and your birthday. Five wrong tries pause
          withdrawals for 30 minutes.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            {hasPin ? "New PIN" : "PIN"}
            <input
              className="input pin-input mt-1"
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              autoComplete="off"
              required
            />
          </label>
          <label className="block text-sm font-medium">
            Confirm PIN
            <input
              className="input pin-input mt-1"
              name="confirmPin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              autoComplete="off"
              required
            />
          </label>
        </div>
        <label className="mt-4 block text-sm font-medium">
          Account password
          <input className="input mt-1" type="password" name="password" autoComplete="current-password" required />
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
