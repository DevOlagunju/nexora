import { NextResponse } from "next/server";
import {
  createSession,
  getRequestUser,
  destroySession,
  destroyAllSessionsForUser,
  jsonError,
} from "@/lib/auth";
import { ipFromHeaders, writeAudit } from "@/lib/security";
import { toResponse } from "@/lib/services/result";
import {
  authenticate,
  changePassword,
  finishPasswordReset,
  registerUser,
  startPasswordReset,
} from "@/lib/services/accounts";

export const dynamic = "force-dynamic";

/**
 * Mobile / JSON auth endpoint. Body: { action, ...fields }.
 * Actions: login (default), register, logout, logout_all, change_password,
 * forgot_password, reset_password. Sessions are returned as bearer tokens.
 */

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
  if (!body || typeof body !== "object") return jsonError("Invalid JSON body.");

  const action = String(body.action ?? "login");
  const ctx = {
    ip: ipFromHeaders(request.headers),
    userAgent: request.headers.get("user-agent") ?? undefined,
  };

  switch (action) {
    case "logout": {
      await destroySession(bearerToken(request));
      return NextResponse.json({ ok: true });
    }

    case "logout_all": {
      const user = await getRequestUser(request);
      if (!user) return jsonError("Unauthorized", 401);
      await destroyAllSessionsForUser(user.id, { clearCookie: !bearerToken(request) });
      await writeAudit("user.logout_all", { userId: user.id, ip: ctx.ip });
      return NextResponse.json({ ok: true });
    }

    case "change_password": {
      const user = await getRequestUser(request);
      if (!user) return jsonError("Unauthorized", 401);
      const result = await changePassword(user, body, { ...ctx, setCookie: !bearerToken(request) });
      return toResponse(result, (d, message) => ({ ok: true, token: d.token, message }));
    }

    case "forgot_password": {
      const result = await startPasswordReset(body, ctx);
      return toResponse(result, (d, message) => ({
        ok: true,
        message,
        ...(d.debugResetUrl ? { debugResetUrl: d.debugResetUrl } : {}),
      }));
    }

    case "reset_password": {
      const result = await finishPasswordReset(body, ctx);
      return toResponse(result, (_d, message) => ({ ok: true, message }));
    }

    case "register": {
      const result = await registerUser(body, ctx);
      if (!result.ok) return jsonError(result.error, result.status);
      const token = await createSession(result.data, { ...ctx, setCookie: false });
      return NextResponse.json({ user: result.data, token });
    }

    case "login": {
      const result = await authenticate(body, ctx);
      if (!result.ok) return jsonError(result.error, result.status);
      const token = await createSession(result.data, { ...ctx, setCookie: false });
      return NextResponse.json({ user: result.data, token });
    }

    default:
      return jsonError("Unknown action.");
  }
}
