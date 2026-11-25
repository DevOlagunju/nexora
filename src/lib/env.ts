import { z } from "zod";

/**
 * Server environment contract. Validated once at boot (see src/instrumentation.ts).
 * Production refuses to start with missing secrets or the public example values.
 */

const EXAMPLE_AUTH_SECRETS = new Set([
  "replace-with-long-random-string-at-least-32-chars",
  "staging-only-long-random-string-at-least-32-chars",
]);
const EXAMPLE_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const EXAMPLE_ADMIN_PASSWORDS = new Set([
  "replace-with-strong-password",
  "StagingOnly!ChangeMe",
  "ChangeMeAdmin!2026",
]);

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .trim()
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a postgresql:// URL (docs/POSTGRES.md)"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be a 64-char hex string (32 bytes)"),
  ADMIN_EMAIL: optionalString,
  ADMIN_PASSWORD: optionalString,
  NEXT_PUBLIC_APP_URL: optionalString,
  NEXT_PUBLIC_SUPPORT_WHATSAPP: optionalString,
  PLATFORM_BANK_NAME: optionalString,
  PLATFORM_BANK_ACCOUNT: optionalString,
  PLATFORM_BANK_ACCOUNT_NAME: optionalString,
  PAYSTACK_SECRET_KEY: optionalString,
  ADMIN_WEBHOOK_URL: optionalString,
  CRON_SECRET: optionalString,
  RESEND_API_KEY: optionalString,
  NOTIFY_FROM_EMAIL: optionalString,
  UPSTASH_REDIS_REST_URL: optionalString,
  UPSTASH_REDIS_REST_TOKEN: optionalString,
  CORS_ALLOWED_ORIGINS: optionalString,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export type EnvReport = {
  errors: string[];
  warnings: string[];
};

/** Pure check so it can be unit tested. */
export function checkEnv(raw: Record<string, string | undefined>): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = serverEnvSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".") || "env"}: ${issue.message}`);
    }
    return { errors, warnings };
  }

  const env = parsed.data;
  const prod = env.NODE_ENV === "production";
  const push = (msg: string, fatalInProd: boolean) =>
    (prod && fatalInProd ? errors : warnings).push(msg);

  if (EXAMPLE_AUTH_SECRETS.has(env.AUTH_SECRET)) {
    push("AUTH_SECRET is the public example value - generate a new one", true);
  }
  if (env.ENCRYPTION_KEY.toLowerCase() === EXAMPLE_ENCRYPTION_KEY) {
    push("ENCRYPTION_KEY is the public example value - gift codes are not protected", true);
  }
  if (env.ADMIN_PASSWORD && EXAMPLE_ADMIN_PASSWORDS.has(env.ADMIN_PASSWORD)) {
    push("ADMIN_PASSWORD is an example value", true);
  }

  if (prod) {
    if (!env.NEXT_PUBLIC_APP_URL?.startsWith("https://")) {
      warnings.push("NEXT_PUBLIC_APP_URL should be your https:// origin (used in reset emails)");
    }
    if (!env.PLATFORM_BANK_ACCOUNT || /^0+$|^0123456789$/.test(env.PLATFORM_BANK_ACCOUNT)) {
      warnings.push("PLATFORM_BANK_ACCOUNT is unset or a placeholder - buy orders show a fake account");
    }
    if (!env.RESEND_API_KEY || !env.NOTIFY_FROM_EMAIL) {
      warnings.push("RESEND_API_KEY / NOTIFY_FROM_EMAIL unset - password reset emails will not send");
    }
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
      warnings.push("Upstash Redis unset - rate limits are per-instance memory only");
    }
    if ((raw.DEPOSIT_PROVIDER ?? "").trim().toLowerCase() === "simulated") {
      // The simulated provider would let anyone with the test secret report deposits that never happened.
      errors.push("DEPOSIT_PROVIDER=simulated is for local testing only. Unset it or use a real provider in production.");
    }
    if (env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_")) {
      warnings.push("PAYSTACK_SECRET_KEY is a TEST key");
    }
  }

  return { errors, warnings };
}

/** Throws in production when the environment is unsafe; logs warnings otherwise. */
export function assertServerEnv(raw: Record<string, string | undefined> = process.env) {
  const { errors, warnings } = checkEnv(raw);
  for (const w of warnings) console.warn(`[env] ${w}`);
  if (errors.length) {
    const msg = `Invalid server environment:\n - ${errors.join("\n - ")}`;
    if (raw.NODE_ENV === "production") throw new Error(msg);
    console.error(`[env] ${msg}`);
  }
}
