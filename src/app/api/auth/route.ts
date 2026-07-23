import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import {
  createSession,
  getRequestUser,
  destroySession,
  destroyAllSessionsForUser,
  jsonError,
} from "@/lib/auth";
import { rateLimit, writeAudit } from "@/lib/security";
import { changePasswordSchema, forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from "@/lib/validators";
import { consumePasswordReset, requestPasswordReset } from "@/lib/password-reset";

export const dynamic = "force-dynamic";

function bearerToken(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return undefined;
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return jsonError("Unauthorized", 401);
  return NextResponse.json({ user });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? "login");
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (action === "logout") {
    const token = bearerToken(request);
    await destroySession(token);
    return NextResponse.json({ ok: true });
  }

  if (action === "logout_all") {
    const user = await getRequestUser(request);
    if (!user) return jsonError("Unauthorized", 401);
    await destroyAllSessionsForUser(user.id, { clearCookie: !bearerToken(request) });
    await writeAudit("user.logout_all", { userId: user.id, ip });
    return NextResponse.json({ ok: true });
  }

  if (action === "change_password") {
    const user = await getRequestUser(request);
    if (!user) return jsonError("Unauthorized", 401);
    if (!rateLimit(`m-pwd:${user.id}`, 5, 60_000)) {
      return jsonError("Too many attempts. Try again shortly.", 429);
    }

    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "Invalid input");
    }

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) return jsonError("Account not found.", 404);

    const valid = await bcrypt.compare(parsed.data.currentPassword, dbUser.passwordHash);
    if (!valid) {
      await writeAudit("user.password_change_failed", { userId: user.id, ip });
      return jsonError("Current password is incorrect.", 401);
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await destroyAllSessionsForUser(user.id, { clearCookie: false });

    const token = await createSession(user, {
      userAgent: request.headers.get("user-agent") ?? undefined,
      ip,
      setCookie: !bearerToken(request),
    });
    await writeAudit("user.password_change", { userId: user.id, ip });
    return NextResponse.json({
      ok: true,
      token,
      message: "Password updated. Other devices were signed out.",
    });
  }

  if (action === "forgot_password") {
    if (!rateLimit(`m-forgot:${ip}`, 5, 60_000)) {
      return jsonError("Too many attempts. Try again shortly.", 429);
    }
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "Invalid email");
    }
    if (!rateLimit(`m-forgot-email:${parsed.data.email.toLowerCase()}`, 3, 15 * 60_000)) {
      return jsonError("Too many reset emails for this address. Try again later.", 429);
    }
    const result = await requestPasswordReset(parsed.data.email);
    await writeAudit("user.password_reset_request", {
      ip,
      meta: { email: parsed.data.email.toLowerCase() },
    });
    return NextResponse.json({
      ok: true,
      message: result.message,
      ...(result.debugResetUrl && process.env.NODE_ENV !== "production"
        ? { debugResetUrl: result.debugResetUrl }
        : {}),
    });
  }

  if (action === "reset_password") {
    if (!rateLimit(`m-reset:${ip}`, 8, 60_000)) {
      return jsonError("Too many attempts. Try again shortly.", 429);
    }
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const result = await consumePasswordReset({
      token: parsed.data.token,
      newPassword: parsed.data.newPassword,
    });
    if (!result.ok) {
      await writeAudit("user.password_reset_failed", { ip });
      return jsonError(result.error, 400);
    }
    await writeAudit("user.password_reset", { ip });
    return NextResponse.json({
      ok: true,
      message: "Password updated. You can log in with your new password.",
    });
  }

  if (action === "register") {
    if (!rateLimit(`m-register:${ip}`, 5, 60_000)) {
      return jsonError("Too many attempts. Try again shortly.", 429);
    }
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "Invalid input");
    }
    const { fullName, email, phone, password } = parsed.data;
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { phone }] },
    });
    if (existing) return jsonError("An account with that email or phone already exists.");

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        fullName,
        email: email.toLowerCase(),
        phone,
        passwordHash,
        kyc: { create: {} },
      },
    });

    const sessionUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
    };
    const token = await createSession(sessionUser, {
      userAgent: request.headers.get("user-agent") ?? undefined,
      ip,
      setCookie: false,
    });
    await writeAudit("user.register", { userId: user.id, ip });
    return NextResponse.json({ user: sessionUser, token });
  }

  // login
  if (!rateLimit(`m-login:${ip}`, 10, 60_000)) {
    return jsonError("Too many attempts. Try again shortly.", 429);
  }
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid email or password.");

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (!user) return jsonError("Invalid email or password.", 401);

  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) {
    await writeAudit("user.login_failed", { userId: user.id, ip });
    return jsonError("Invalid email or password.", 401);
  }

  const sessionUser = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
  };
  const token = await createSession(sessionUser, {
    userAgent: request.headers.get("user-agent") ?? undefined,
    ip,
    setCookie: false,
  });
  await writeAudit("user.login", { userId: user.id, ip });
  return NextResponse.json({ user: sessionUser, token });
}
