import "server-only";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/crypto";

/**
 * Idempotency keys for the v1 API. A client sends `Idempotency-Key: <unique value>` with a
 * request that creates something (an order, a withdrawal, a payment). If the request is
 * retried with the same key, the stored first response is returned and nothing runs twice.
 *
 *   same key + same request, finished   -> the first response again (Idempotent-Replay: true)
 *   same key + same request, running    -> 409, try again shortly
 *   same key + a different request      -> 422, the key belongs to another request
 *
 * Server errors (5xx), rate limits (429) and thrown errors are not stored, so the client may retry them.
 */

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;
/** A first request that has not finished after this long is treated as dead and may be retried. */
const IN_PROGRESS_STALE_MS = 60_000;
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60_000;

export type IdempotencyProblem = { status: number; code: string; message: string };

export function idempotencyKeyProblem(key: string | null): IdempotencyProblem | null {
  if (!key) {
    return {
      status: 400,
      code: "idempotency_key_required",
      message: "Send an Idempotency-Key header (a unique value per attempt, reused on retry).",
    };
  }
  if (!KEY_PATTERN.test(key)) {
    return {
      status: 400,
      code: "idempotency_key_invalid",
      message: "Idempotency-Key must be 8-128 characters: letters, digits, - _ : .",
    };
  }
  return null;
}

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "P2002";

/**
 * Runs `handler` at most once per (user, key). `problem` builds the error response in the
 * caller's envelope, so this module stays independent of the response format.
 */
export async function withIdempotency(
  input: { userId: string; key: string | null; method: string; path: string; rawBody: string },
  handler: () => Promise<Response>,
  problem: (p: IdempotencyProblem) => Response,
): Promise<Response> {
  const bad = idempotencyKeyProblem(input.key);
  if (bad) return problem(bad);
  const key = input.key!;
  const requestHash = sha256(`${input.method} ${input.path}\n${input.rawBody}`);
  const where = { userId_key: { userId: input.userId, key } };

  let claimed = false;
  try {
    await prisma.idempotencyKey.create({ data: { userId: input.userId, key, requestHash } });
    claimed = true;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  if (!claimed) {
    const existing = await prisma.idempotencyKey.findUnique({ where });
    if (!existing) return problem({ status: 409, code: "request_in_progress", message: "Try again shortly." });
    if (existing.requestHash !== requestHash) {
      return problem({
        status: 422,
        code: "idempotency_key_reused",
        message: "This Idempotency-Key was already used for a different request.",
      });
    }
    if (existing.responseStatus !== null) {
      return new Response(existing.responseBody ?? "", {
        status: existing.responseStatus,
        headers: { "Content-Type": "application/json", "Idempotent-Replay": "true" },
      });
    }
    // The first attempt has not finished. Only take over if it has clearly died.
    const stale = Date.now() - existing.createdAt.getTime() > IN_PROGRESS_STALE_MS;
    const tookOver = stale
      ? (await prisma.idempotencyKey.updateMany({
          where: { id: existing.id, responseStatus: null, createdAt: existing.createdAt },
          data: { createdAt: new Date() },
        })).count > 0
      : false;
    if (!tookOver) {
      return problem({
        status: 409,
        code: "request_in_progress",
        message: "The first request with this Idempotency-Key is still being processed. Try again shortly.",
      });
    }
  }

  let response: Response;
  try {
    response = await handler();
  } catch (err) {
    await prisma.idempotencyKey.deleteMany({ where: { userId: input.userId, key, responseStatus: null } });
    throw err;
  }

  // Not stored: the client should be able to retry these with the same key.
  if (response.status >= 500 || response.status === 429) {
    await prisma.idempotencyKey.deleteMany({ where: { userId: input.userId, key, responseStatus: null } });
    return response;
  }
  const body = await response.clone().text();
  await prisma.idempotencyKey.updateMany({
    where: { userId: input.userId, key, responseStatus: null },
    data: { responseStatus: response.status, responseBody: body },
  });
  return response;
}

/** Cron leg: forget keys older than the retention window. */
export async function purgeIdempotencyKeys(now = new Date()) {
  const { count } = await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS) } },
  });
  return count;
}
