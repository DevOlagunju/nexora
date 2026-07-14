import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession, getRequestUser, destroySession, jsonError } from "@/lib/auth";
import { rateLimit, writeAudit } from "@/lib/security";
import { loginSchema, registerSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

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
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    await destroySession(token);
    return NextResponse.json({ ok: true });
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
