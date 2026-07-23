import { redirect } from "next/navigation";
import { submitKycAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ActionForm } from "@/components/action-form";
import { StatusPill } from "@/components/status-pill";

export default async function KycPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const kyc = await prisma.kycProfile.findUnique({ where: { userId: user.id } });
  const status = kyc?.status ?? "UNVERIFIED";

  return (
    <div className="mx-auto max-w-xl">
      <p className="section-label">KYC</p>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">Identity & bank</h1>
      <p className="mt-2 text-sm text-ink-soft">
        We keep only BVN/NIN last 4 digits. Full numbers are used for verification and not stored.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <StatusPill status={status} />
        {kyc?.reviewNote && <p className="text-sm text-ink-soft">Note: {kyc.reviewNote}</p>}
      </div>

      {kyc?.status !== "APPROVED" && (
        <ActionForm action={submitKycAction} className="panel mt-6" submitLabel="Submit KYC">
          <label className="block text-sm font-medium">
            BVN (11 digits)
            <input className="input mt-1" name="bvn" inputMode="numeric" required maxLength={11} />
          </label>
          <label className="mt-4 block text-sm font-medium">
            NIN (11 digits)
            <input className="input mt-1" name="nin" inputMode="numeric" required maxLength={11} />
          </label>
          <label className="mt-4 block text-sm font-medium">
            Bank name
            <input className="input mt-1" name="bankName" required />
          </label>
          <label className="mt-4 block text-sm font-medium">
            Account number
            <input className="input mt-1" name="accountNumber" inputMode="numeric" required maxLength={10} />
          </label>
          <label className="mt-4 block text-sm font-medium">
            Account name
            <input className="input mt-1" name="accountName" required />
          </label>
        </ActionForm>
      )}

      {kyc?.status === "APPROVED" && (
        <p className="ops-hint mt-6">You&apos;re verified. You can sell crypto, buy crypto, or sell gift cards.</p>
      )}
    </div>
  );
}
