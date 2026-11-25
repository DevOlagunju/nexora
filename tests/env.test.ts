import { describe, expect, it } from "vitest";
import { checkEnv } from "@/lib/env";

const good = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db:5432/nexora",
  AUTH_SECRET: "k".repeat(48),
  ENCRYPTION_KEY: "ab".repeat(32),
  NEXT_PUBLIC_APP_URL: "https://nexora.example",
  PLATFORM_BANK_ACCOUNT: "1234567890",
  RESEND_API_KEY: "re_x",
  NOTIFY_FROM_EMAIL: "Nexora <o@nexora.example>",
  UPSTASH_REDIS_REST_URL: "https://x.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "t",
};

describe("checkEnv", () => {
  it("accepts a complete production env with no warnings", () => {
    expect(checkEnv(good)).toEqual({ errors: [], warnings: [] });
  });

  it("rejects missing or malformed secrets", () => {
    const r = checkEnv({ ...good, AUTH_SECRET: "short", ENCRYPTION_KEY: "nothex" });
    expect(r.errors.join(" ")).toMatch(/AUTH_SECRET/);
    expect(r.errors.join(" ")).toMatch(/ENCRYPTION_KEY/);
  });

  it("refuses example secrets in production but only warns in development", () => {
    const example = { ...good, ENCRYPTION_KEY: "0123456789abcdef".repeat(4) };
    expect(checkEnv(example).errors.length).toBe(1);
    const dev = checkEnv({ ...example, NODE_ENV: "development" });
    expect(dev.errors).toEqual([]);
    expect(dev.warnings.join(" ")).toMatch(/ENCRYPTION_KEY/);
  });

  it("warns about test Paystack keys in production", () => {
    const r = checkEnv({ ...good, PAYSTACK_SECRET_KEY: "sk_test_abc" });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/TEST key/);
    expect(r.warnings.join(" ")).toMatch(/TEST key/);
  });
});
