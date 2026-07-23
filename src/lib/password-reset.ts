import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { appBaseUrl, newResetToken, sendEmail } from "@/lib/email";
import { destroyAllSessionsForUser } from "@/lib/auth";
import bcrypt from "bcryptjs";

const RESET_TTL_MS = 60 * 60 * 1000;
const GENERIC_OK =
  "If that email is registered, we sent a reset link. Check your inbox (and spam).";

export async function requestPasswordReset(emailRaw: string): Promise<{
  ok: true;
  message: string;
  /** Only returned when RESEND is missing (local/dev). */
  debugResetUrl?: string;
}> {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return { ok: true, message: GENERIC_OK };
  }

  await prisma.passwordResetToken.deleteMany({
    where: { userId: user.id, usedAt: null },
  });

  const token = newResetToken();
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt,
    },
  });

  const webUrl = `${appBaseUrl()}/reset-password?token=${token}`;
  const mobileUrl = `nexora://reset-password?token=${token}`;

  const sent = await sendEmail({
    to: user.email,
    subject: "Reset your Nexora password",
    text: [
      "Reset your Nexora password using this link (expires in 1 hour):",
      webUrl,
      "",
      "On the mobile app you can also open:",
      mobileUrl,
      "",
      "If you did not request this, ignore this email.",
    ].join("\n"),
    html: `
      <p>Reset your Nexora password using this link (expires in 1 hour):</p>
      <p><a href="${webUrl}">${webUrl}</a></p>
      <p>On mobile you can also open: <a href="${mobileUrl}">${mobileUrl}</a></p>
      <p>If you did not request this, ignore this email.</p>
    `,
  });

  if (!sent.ok) {
    return {
      ok: true,
      message: "We could not send email right now. Try again shortly or contact support.",
    };
  }

  if (sent.logged && process.env.NODE_ENV === "production") {
    return {
      ok: true,
      message: "Password reset email is not configured yet. Contact support on WhatsApp.",
    };
  }

  return {
    ok: true,
    message: GENERIC_OK,
    ...(sent.logged ? { debugResetUrl: webUrl } : {}),
  };
}

export async function consumePasswordReset(input: {
  token: string;
  newPassword: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const tokenHash = sha256(input.token.trim());
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!row || row.usedAt || row.expiresAt < new Date()) {
    return { ok: false, error: "This reset link is invalid or has expired." };
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.deleteMany({
      where: { userId: row.userId, usedAt: null, id: { not: row.id } },
    }),
  ]);

  await destroyAllSessionsForUser(row.userId, { clearCookie: true });
  return { ok: true };
}
