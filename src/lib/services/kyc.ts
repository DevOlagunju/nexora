import "server-only";
import { prisma } from "@/lib/db";
import { rateLimit, writeAudit } from "@/lib/security";
import { bankLookupSchema, kycSchema } from "@/lib/validators";
import { bankByCode, resolveAccountName } from "@/lib/banks";
import { namesMatch } from "@/lib/bank-rules";
import { verifyKycIdentity } from "@/lib/kyc-provider";
import { notifyAdmin } from "@/lib/notify";
import { sendEmail } from "@/lib/email";
import { fail, ok, TOO_MANY, type ServiceResult } from "@/lib/services/result";

type Actor = { id: string; email: string };

/** Customer submits KYC. Only the last 4 digits of BVN/NIN are persisted. */
export async function submitKyc(
  user: Actor,
  input: unknown,
  ctx: { ip: string },
): Promise<ServiceResult<{ status: string }>> {
  if (!(await rateLimit(`kyc:${user.id}`, 5, 10 * 60_000))) return TOO_MANY("KYC submissions");

  const parsed = kycSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const { bvn, nin, accountNumber } = parsed.data;
  let bankName = parsed.data.bankName ?? "";
  let accountName = parsed.data.accountName ?? "";
  let bankCode: string | null = null;
  let accountVerified = false;
  let nameMatch: boolean | null = null;

  if (parsed.data.bankCode) {
    // Never trust a client-supplied name when we can ask the bank: look it up again here.
    const bank = await bankByCode(parsed.data.bankCode);
    if (!bank) return fail("Pick your bank from the list.");
    const me = await prisma.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
    const lookup = await resolveAccountName(accountNumber, bank.code, me?.fullName ?? "");
    if (!lookup.ok) return fail(lookup.error, 422);
    bankCode = bank.code;
    bankName = bank.name;
    accountName = lookup.accountName;
    accountVerified = lookup.mode === "live";
    nameMatch = namesMatch(lookup.accountName, me?.fullName ?? "");
  }

  const check = await verifyKycIdentity({ bvn, nin, bankName, accountNumber, accountName });
  const status = check.status;
  const fields = {
    bvnLast4: bvn.slice(-4),
    ninLast4: nin.slice(-4),
    bankName,
    bankCode,
    accountNumber,
    accountName,
    accountVerified,
    nameMatch,
    status,
    submittedAt: new Date(),
    reviewNote: check.mode === "provider" ? check.message : null,
    reviewedAt: status === "APPROVED" || status === "REJECTED" ? new Date() : null,
  };

  await prisma.kycProfile.upsert({
    where: { userId: user.id },
    update: fields,
    create: { userId: user.id, ...fields },
  });

  await writeAudit("kyc.submit", {
    userId: user.id,
    ip: ctx.ip,
    meta: { bvnLast4: fields.bvnLast4, ninLast4: fields.ninLast4, mode: check.mode, status, bankCode, accountVerified, nameMatch },
  });
  void notifyAdmin("kyc.submitted", { userId: user.id, email: user.email, status, mode: check.mode });

  return ok({ status }, check.message);
}

/** Desk approves or rejects a pending KYC profile and tells the customer. */
export async function reviewKyc(
  admin: Actor,
  input: { id?: unknown; status?: unknown; reviewNote?: unknown },
): Promise<ServiceResult<null>> {
  const id = String(input.id ?? "").trim();
  const status = String(input.status ?? "");
  const reviewNote = String(input.reviewNote ?? "").trim().slice(0, 500);
  if (!id || (status !== "APPROVED" && status !== "REJECTED")) return fail("Invalid KYC review.");

  const profile = await prisma.kycProfile.findUnique({
    where: { id },
    include: { user: { select: { email: true } } },
  });
  if (!profile) return fail("KYC profile not found.", 404);

  await prisma.kycProfile.update({
    where: { id },
    data: { status, reviewNote: reviewNote || null, reviewedAt: new Date() },
  });
  await writeAudit("admin.kyc_review", { userId: admin.id, meta: { id, status } });

  void sendEmail({
    to: profile.user.email,
    subject: status === "APPROVED" ? "Your Nexora account is verified" : "Nexora verification needs attention",
    text:
      status === "APPROVED"
        ? "Your KYC was approved. You can now buy and sell crypto and gift cards on Nexora."
        : `Your KYC could not be approved.${reviewNote ? ` Reason: ${reviewNote}` : ""} Please resubmit from your dashboard or contact support.`,
  });

  return ok(null, `KYC ${status.toLowerCase()}.`);
}

/** Live account-name lookup while the customer fills in KYC. Rate-limited: Paystack meters these. */
export async function lookupBankAccount(
  user: Actor,
  input: unknown,
): Promise<ServiceResult<{ accountName: string; bankName: string; nameMatch: boolean; mode: "live" | "test" }>> {
  if (!(await rateLimit(`bank-lookup:${user.id}`, 12, 10 * 60_000))) return TOO_MANY("account lookups");
  const parsed = bankLookupSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const bank = await bankByCode(parsed.data.bankCode);
  if (!bank) return fail("Pick your bank from the list.");
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
  const lookup = await resolveAccountName(parsed.data.accountNumber, bank.code, me?.fullName ?? "");
  if (!lookup.ok) return fail(lookup.error, 422);
  return ok({
    accountName: lookup.accountName,
    bankName: bank.name,
    nameMatch: namesMatch(lookup.accountName, me?.fullName ?? ""),
    mode: lookup.mode,
  });
}
