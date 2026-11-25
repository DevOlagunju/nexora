import "server-only";
import { randomUUID } from "node:crypto";
import { getRequestUser, type SessionUser } from "@/lib/auth";
import { ipFromHeaders } from "@/lib/security";
import { publicOrigin } from "@/lib/origin";
import { errorMessage, log } from "@/lib/log";
import type { ServiceResult } from "@/lib/services/result";
import { withIdempotency } from "@/lib/api/idempotency";

/**
 * Conventions for /api/v1 (see docs/API.md).
 *
 *   success   200/201   { "data": ..., "message"?: "..." }
 *   failure   4xx/5xx   { "error": { "code": "not_found", "message": "..." } }
 *
 * Route files stay thin: authenticate, read the body, call a service in src/lib/services,
 * map the result. No business rules live in a route. Sessions are bearer tokens
 * (`Authorization: Bearer <token>`) or the web session cookie.
 */

export type RequestCtx = { ip: string; origin: string; userAgent?: string };
export type Json = Record<string, unknown>;

const CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "unprocessable",
  423: "locked",
  429: "rate_limited",
  500: "internal_error",
  502: "upstream_error",
  503: "unavailable",
};

export function data<T>(payload: T, opts: { status?: number; message?: string } = {}): Response {
  return Response.json(opts.message ? { data: payload, message: opts.message } : { data: payload }, {
    status: opts.status ?? 200,
  });
}

export function fail(status: number, message: string, code?: string): Response {
  return Response.json({ error: { code: code ?? CODES[status] ?? "error", message } }, { status });
}

/** Map a service result into the v1 envelope. */
export function fromResult<T>(
  result: ServiceResult<T>,
  shape: (d: T) => unknown = (d) => d,
  okStatus = 200,
): Response {
  if (!result.ok) return fail(result.status, result.error);
  return data(shape(result.data), { status: okStatus, message: result.message });
}

export function requestCtx(request: Request): RequestCtx {
  return {
    ip: ipFromHeaders(request.headers),
    origin: publicOrigin(request.headers),
    userAgent: request.headers.get("user-agent") ?? undefined,
  };
}

export function bearerToken(request: Request): string | undefined {
  const auth = request.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
}

/** Reads a JSON object body. Returns null when the body is present but is not a JSON object. */
function parseBody(raw: string): Json | null {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : null;
  } catch {
    return null;
  }
}

/** Every response gets a request id; an unexpected error becomes a clean 500 and is logged with it. */
async function guard(request: Request, run: () => Promise<Response>): Promise<Response> {
  const requestId = request.headers.get("x-request-id")?.slice(0, 64) || randomUUID();
  let response: Response;
  try {
    response = await run();
  } catch (err) {
    log.error("api v1: unhandled error", {
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      error: errorMessage(err),
    });
    response = fail(500, "Something went wrong on our side. Please try again.");
  }
  const headers = new Headers(response.headers);
  headers.set("X-Request-Id", requestId);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

type RouteArgs<P> = { params: Promise<P> };
type OpenArgs<P> = { request: Request; ctx: RequestCtx; params: P; body: Json; query: URLSearchParams };
type AuthedArgs<P> = OpenArgs<P> & { user: SessionUser };

async function prepare<P>(request: Request, route: RouteArgs<P>) {
  const hasBody = request.method !== "GET" && request.method !== "DELETE" && request.method !== "HEAD";
  const raw = hasBody ? await request.text() : "";
  const body = parseBody(raw);
  return { raw, body, params: await route.params, ctx: requestCtx(request), query: new URL(request.url).searchParams };
}

/** A route anyone may call (login, register, public rates). */
export function open<P = Record<string, never>>(handler: (a: OpenArgs<P>) => Promise<Response>) {
  return (request: Request, route: RouteArgs<P>) =>
    guard(request, async () => {
      const p = await prepare(request, route);
      if (!p.body) return fail(400, "Request body must be a JSON object.");
      return handler({ request, ctx: p.ctx, params: p.params, body: p.body, query: p.query });
    });
}

/**
 * A route for a signed-in user. With `idempotent: true` the request must carry an
 * Idempotency-Key header and runs at most once per key (src/lib/api/idempotency.ts).
 */
export function authed<P = Record<string, never>>(
  handler: (a: AuthedArgs<P>) => Promise<Response>,
  opts: { idempotent?: boolean } = {},
) {
  return (request: Request, route: RouteArgs<P>) =>
    guard(request, async () => {
      const user = await getRequestUser(request);
      if (!user) return fail(401, "Sign in to continue.");
      const p = await prepare(request, route);
      if (!p.body) return fail(400, "Request body must be a JSON object.");
      const run = () => handler({ request, user, ctx: p.ctx, params: p.params, body: p.body!, query: p.query });
      if (!opts.idempotent) return run();
      return withIdempotency(
        {
          userId: user.id,
          key: request.headers.get("idempotency-key"),
          method: request.method,
          path: new URL(request.url).pathname,
          rawBody: p.raw,
        },
        run,
        (problem) => fail(problem.status, problem.message, problem.code),
      );
    });
}

/** `?limit=` clamped to a sane page size. */
export function pageSize(query: URLSearchParams, fallback = 20, max = 100): number {
  const n = Number(query.get("limit"));
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}
