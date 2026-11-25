import { prisma } from "@/lib/db";
import { unreadNotificationCount } from "@/lib/services/notifications";
import { authed, data } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/users/me  The signed-in user with the few facts every screen needs. */
export const GET = authed(async ({ user }) => {
  const [me, kyc, unread] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { walletBalanceNgn: true, transactionPinHash: true, referralCode: true, createdAt: true },
    }),
    prisma.kycProfile.findUnique({ where: { userId: user.id }, select: { status: true } }),
    unreadNotificationCount(user.id),
  ]);
  return data({
    user,
    kycStatus: kyc?.status ?? "UNVERIFIED",
    wallet: { balanceNgn: Math.max(0, me?.walletBalanceNgn ?? 0), hasPin: !!me?.transactionPinHash },
    referralCode: me?.referralCode ?? null,
    unreadNotifications: unread,
    memberSince: me?.createdAt ?? null,
  });
});
