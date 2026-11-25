import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession, destroyAllSessionsForUser, type SessionUser } from "@/lib/auth";
import { rateLimit, writeAudit } from "@/lib/security";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validators";
import { consumePasswordReset, requestPasswordReset } from "@/lib/password-reset";
import { fail, ok, TOO_MANY, type ServiceResult } from "@/lib/services/result";
import { newReferralCode } from "@/lib/services/wallet";

/**
 * Account flows shared by web server actions and the mobile JSON API.
 * Callers decide how the session is delivered (cookie for web, bearer token for mobile).
 */

type Ctx = { ip: string; userAgent?: string };

const BCRYPT_COST = 12;
const INVALID_LOGIN = "Invalid email or password.";
// Compared against when the email is unknown so response time does not reveal registered emails.
const DUMMY_HASH = "$2b$12$8U5P7hwn17zrTJGeYhlFUOp3W2fFc/c.WlGIbHkxOoYJF8UZmGEOW";

function toSessionUser(u: { id: string; email: string; fullName: string; phone: string; role: SessionUser["role"]; staffRole?: SessionUser["staffRole"] }) {
  return { id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, role: u.role, staffRole: u.staffRole ?? null } satisfies SessionUser;
}

export async function registerUser(
  input: unknown,
  ctx: Ctx,
): Promise<ServiceResult<SessionUser>> {
  if (!(await rateLimit(`register:${ctx.ip}`, 5, 60_000))) return TOO_MANY();

  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const { fullName, phone, password } = parsed.data;
  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (existing) return fail("An account with that email or phone already exists.", 409);

  let referredById: string | undefined;
  if (parsed.data.referralCode) {
    const referrer = await prisma.user.findUnique({
      where: { referralCode: parsed.data.referralCode },
      select: { id: true },
    });
    if (!referrer) return fail("That referral code isn't valid. Check it or leave it blank.");
    referredById = referrer.id;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  let user;
  try {
    user = await prisma.user.create({
      data: {
        fullName,
        email,
        phone,
        passwordHash,
        referralCode: newReferralCode(),
        referredById,
        kyc: { create: {} },
      },
    });
  } catch (err) {
    // Unique constraint race between the check above and the insert.
    if ((err as { code?: string })?.code === "P2002") {
      return fail("An account with that email or phone already exists.", 409);
    }
    throw err;
  }

  await writeAudit("user.register", { userId: user.id, ip: ctx.ip, meta: referredById ? { referredById } : undefined });
  return ok(toSessionUser(user));
}

export async function authenticate(
  input: unknown,
  ctx: Ctx,
): Promise<ServiceResult<SessionUser>> {
  if (!(await rateLimit(`login:${ctx.ip}`, 10, 60_000))) return TOO_MANY();

  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return fail(INVALID_LOGIN, 401);

  const email = parsed.data.email.toLowerCase();
  // Per-account budget slows distributed guessing against one email.
  if (!(await rateLimit(`login-email:${email}`, 10, 15 * 60_000))) return TOO_MANY();

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    if (user) await writeAudit("user.login_failed", { userId: user.id, ip: ctx.ip });
    return fail(INVALID_LOGIN, 401);
  }

  await writeAudit("user.login", { userId: user.id, ip: ctx.ip });
  return ok(toSessionUser(user));
}

/** Verifies the current password, rotates the hash, revokes all sessions and issues a new one. */
export async function changePassword(
  user: SessionUser,
  input: unknown,
  ctx: Ctx & { setCookie: boolean },
): Promise<ServiceResult<{ token: string }>> {
  if (!(await rateLimit(`pwd:${user.id}`, 5, 60_000))) return TOO_MANY();

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser) return fail("Account not found.", 404);

  const valid = await bcrypt.compare(parsed.data.currentPassword, dbUser.passwordHash);
  if (!valid) {
    await writeAudit("user.password_change_failed", { userId: user.id, ip: ctx.ip });
    return fail("Current password is incorrect.", 401);
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_COST);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  await destroyAllSessionsForUser(user.id, { clearCookie: false });
  const token = await createSession(user, {
    userAgent: ctx.userAgent,
    ip: ctx.ip,
    setCookie: ctx.setCookie,
  });

  await writeAudit("user.password_change", { userId: user.id, ip: ctx.ip });
  return ok({ token }, "Password updated. Other devices were signed out.");
}

export async function startPasswordReset(
  input: unknown,
  ctx: Ctx,
): Promise<ServiceResult<{ debugResetUrl?: string }>> {
  if (!(await rateLimit(`forgot:${ctx.ip}`, 5, 60_000))) return TOO_MANY();

  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid email");

  const email = parsed.data.email.toLowerCase();
  if (!(await rateLimit(`forgot-email:${email}`, 3, 15 * 60_000))) {
    return fail("Too many reset emails for this address. Try again later.", 429);
  }

  const result = await requestPasswordReset(email);
  await writeAudit("user.password_reset_request", { ip: ctx.ip, meta: { email } });

  const debugResetUrl =
    result.debugResetUrl && process.env.NODE_ENV !== "production" ? result.debugResetUrl : undefined;
  return ok({ debugResetUrl }, result.message);
}

export async function finishPasswordReset(input: unknown, ctx: Ctx): Promise<ServiceResult<null>> {
  if (!(await rateLimit(`reset:${ctx.ip}`, 8, 60_000))) return TOO_MANY();

  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const result = await consumePasswordReset({
    token: parsed.data.token,
    newPassword: parsed.data.newPassword,
  });
  if (!result.ok) {
    await writeAudit("user.password_reset_failed", { ip: ctx.ip });
    return fail(result.error, 400);
  }

  await writeAudit("user.password_reset", { ip: ctx.ip });
  return ok(null, "Password updated. You can log in with your new password.");
}
