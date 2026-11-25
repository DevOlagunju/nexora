import { prisma } from "@/lib/db";
import { requestWithdrawal } from "@/lib/services/wallet";
import { authed, data, fromResult, pageSize } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/withdrawals?limit= */
export const GET = authed(async ({ user, query }) => {
  const rows = await prisma.withdrawal.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: pageSize(query),
  });
  return data(
    rows.map((w) => ({
      id: w.id,
      reference: w.reference,
      amountNgn: w.amountNgn,
      feeNgn: w.feeNgn,
      status: w.status,
      bankName: w.bankName,
      accountLast4: w.accountNumber.slice(-4),
      note: w.adminNote,
      createdAt: w.createdAt,
      processedAt: w.processedAt,
    })),
  );
});

/**
 * POST /api/v1/withdrawals  (Idempotency-Key required)  { amountNgn, pin } -> { reference }
 * Paid only to the bank account verified in KYC. The amount plus fee is held from the wallet at once.
 */
export const POST = authed(async ({ user, body, ctx }) => fromResult(await requestWithdrawal(user, body, ctx), (d) => d, 201), {
  idempotent: true,
});
