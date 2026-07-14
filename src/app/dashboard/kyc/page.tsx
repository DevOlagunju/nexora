import { redirect } from "next/navigation";
import { submitKycAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ActionForm } from "@/components/action-form";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export default async function KycPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const kyc = await prisma.kycProfile.findUnique({ where: { userId: user.id } });

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">Identity & bank</h1>
        <p className="mt-2 text-sm text-ink-soft">
          We keep only BVN/NIN last 4 digits. Full numbers are used for verification submission and not
          stored.
        </p>
        <div className="card-panel mt-4 text-sm">
          Status: <strong>{kyc?.status ?? "UNVERIFIED"}</strong>
          {kyc?.reviewNote && <p className="mt-2 text-ink-soft">Note: {kyc.reviewNote}</p>}
        </div>

        {kyc?.status !== "APPROVED" && (
          <ActionForm action={submitKycAction} className="card-panel mt-6">
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
      </main>
      <SiteFooter />
    </>
  );
}
