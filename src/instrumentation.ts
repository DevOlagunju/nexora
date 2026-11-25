import type { Instrumentation } from "next";

/**
 * Runs once per server instance before requests are served.
 * Production refuses to boot with missing or example secrets.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertServerEnv } = await import("@/lib/env");
  assertServerEnv();
}

/** Central server error capture (swap the body for Sentry etc. when wired). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  const { log } = await import("@/lib/log");
  log.error("request error", {
    message: e?.message,
    digest: e?.digest,
    path: request.path,
    method: request.method,
    routeType: context.routeType,
    routePath: context.routePath,
  });
};
