import { prisma } from "@/lib/db";
import { authed, data } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/kyc/status  Only the last four digits of BVN/NIN are ever stored or returned. */
export const GET = authed(async ({ user }) => {
  const kyc = await prisma.kycProfile.findUnique({
    where: { userId: user.id },
    select: {
      status: true,
      bvnLast4: true,
      ninLast4: true,
      bankName: true,
      accountNumber: true,
      accountName: true,
      accountVerified: true,
      reviewNote: true,
      submittedAt: true,
      reviewedAt: true,
    },
  });
  return data(kyc ?? { status: "UNVERIFIED" });
});
