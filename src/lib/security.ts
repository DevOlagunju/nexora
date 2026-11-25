import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { log, errorMessage } from "@/lib/log";

const hits = new Map<string, { count: number; resetAt: number }>();
let lastSweep = 0;

/** Per-process fixed window. Used directly in dev and as a fallback if Redis is down. */
export function memoryRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, v] of hits) if (v.resetAt < now) hits.delete(k);
  }
  const row = hits.get(key);
  if (!row || row.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (row.count >= limit) return false;
  row.count += 1;
  return true;
}

async function redisRateLimit(
  url: string,
  token: string,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const redisKey = `nexora:rl:${key}`;
  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["PEXPIRE", redisKey, String(windowMs), "NX"],
    ]),
    signal: AbortSignal.timeout(1500),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const data = (await res.json()) as Array<{ result?: number; error?: string }>;
  const count = Number(data[0]?.result);
  if (!Number.isFinite(count)) throw new Error(data[0]?.error ?? "Upstash bad response");
  return count <= limit;
}

/**
 * Fixed-window rate limit. Shared across instances when UPSTASH_REDIS_REST_URL/TOKEN
 * are set; otherwise per-process memory. Returns true when the call is allowed.
 */
export async function rateLimit(key: string, limit = 20, windowMs = 60_000): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) {
    try {
      return await redisRateLimit(url, token, key, limit, windowMs);
    } catch (err) {
      log.warn("rate-limit: redis unavailable, using memory", { error: errorMessage(err) });
    }
  }
  return memoryRateLimit(key, limit, windowMs);
}

export async function writeAudit(
  action: string,
  opts?: { userId?: string; meta?: Record<string, unknown>; ip?: string },
) {
  await prisma.auditLog.create({
    data: {
      action,
      userId: opts?.userId,
      meta: opts?.meta ? JSON.stringify(opts.meta) : undefined,
      ipHash: opts?.ip ? sha256(opts.ip) : undefined,
    },
  });
}

/** Best-effort client IP from proxy headers. */
export function ipFromHeaders(h: Pick<Headers, "get">): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export { STATUS_LABEL } from "@/lib/order-status";
