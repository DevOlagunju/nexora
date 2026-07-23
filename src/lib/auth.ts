import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import type { Role } from "@/generated/prisma/client";

const COOKIE_NAME = "nexora_session";
const SESSION_DAYS = 7;

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  role: Role;
};

async function resolveUserFromToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            phone: true,
            role: true,
          },
        },
      },
    });

    if (!session || session.expiresAt < new Date()) return null;
    if (payload.sub !== session.user.id) return null;
    return session.user;
  } catch {
    return null;
  }
}

/** Create session; returns raw JWT for mobile clients. Also sets HttpOnly cookie for web. */
export async function createSession(
  user: SessionUser,
  meta?: { userAgent?: string; ip?: string; setCookie?: boolean },
): Promise<string> {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const token = await new SignJWT({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.fullName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSecret());

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt,
      userAgent: meta?.userAgent?.slice(0, 255),
      ipHash: meta?.ip ? sha256(meta.ip) : undefined,
    },
  });

  if (meta?.setCookie !== false) {
    const jar = await cookies();
    jar.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  }

  return token;
}

export async function destroySession(tokenOverride?: string) {
  const jar = await cookies();
  const token = tokenOverride ?? jar.get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  }
  if (!tokenOverride) jar.delete(COOKIE_NAME);
}

/** Revoke every session for a user. Clears web cookie when it belongs to that user. */
export async function destroyAllSessionsForUser(
  userId: string,
  opts?: { clearCookie?: boolean },
) {
  await prisma.session.deleteMany({ where: { userId } });
  if (opts?.clearCookie !== false) {
    const jar = await cookies();
    jar.delete(COOKIE_NAME);
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const user = await resolveUserFromToken(token);
  if (!user) await destroySession();
  return user;
}

/** Cookie or Authorization: Bearer <token> (mobile) */
export async function getRequestUser(request: Request): Promise<SessionUser | null> {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return resolveUserFromToken(auth.slice(7).trim());
  }
  return getSessionUser();
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("FORBIDDEN");
  return user;
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
