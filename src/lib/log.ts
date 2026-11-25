/**
 * Minimal structured logger. JSON lines in production (for log drains),
 * readable output in development. Never pass raw gift codes, full BVN/NIN or tokens.
 */

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") {
    const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...fields });
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
    return;
  }
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  if (fields && Object.keys(fields).length) fn(`[${level}] ${msg}`, fields);
  else fn(`[${level}] ${msg}`);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== "production") emit("debug", msg, fields);
  },
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
