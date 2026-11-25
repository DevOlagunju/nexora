import { afterEach, describe, expect, it, vi } from "vitest";
import { cryptoSellSchema, giftCardSellSchema, kycSchema, registerSchema } from "@/lib/validators";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const { memoryRateLimit, rateLimit } = await import("@/lib/security");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("validators", () => {
  it("requires a Nigerian mobile number and a strong password", () => {
    const base = { fullName: "Ada Obi", email: "ada@example.com", phone: "08031234567", password: "Str0ngPassword" };
    expect(registerSchema.safeParse(base).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, phone: "+2348031234567" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "weakpass" }).success).toBe(false);
  });

  it("accepts only 11-digit BVN/NIN and 10-digit NUBAN", () => {
    const base = {
      bvn: "12345678901",
      nin: "12345678901",
      bankName: "GTBank",
      accountNumber: "0123456789",
      accountName: "Ada Obi",
    };
    expect(kycSchema.safeParse(base).success).toBe(true);
    expect(kycSchema.safeParse({ ...base, bvn: "1234" }).success).toBe(false);
    expect(kycSchema.safeParse({ ...base, accountNumber: "12345" }).success).toBe(false);
  });

  it("coerces numeric strings from forms and checks the shape of asset codes", () => {
    expect(cryptoSellSchema.parse({ symbol: "USDT", amountCrypto: "25" }).amountCrypto).toBe(25);
    // Whether DOGE trades is the registry's call (tests/db/assets.test.ts), not a list in the validator.
    expect(cryptoSellSchema.safeParse({ symbol: "DOGE", amountCrypto: 1 }).success).toBe(true);
    expect(cryptoSellSchema.safeParse({ symbol: "<script>", amountCrypto: 1 }).success).toBe(false);
    expect(cryptoSellSchema.safeParse({ symbol: "BTC", amountCrypto: -1 }).success).toBe(false);
    expect(giftCardSellSchema.parse({ brand: "APPLE", faceValueUsd: "100", cardCode: "XXXX-YYYY" }).country).toBe(
      "USA",
    );
  });
});

describe("rate limiting", () => {
  it("allows up to the limit within a window, then blocks, then resets", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(memoryRateLimit("k1", 3, 1000, t0)).toBe(true);
    expect(memoryRateLimit("k1", 3, 1000, t0 + 10)).toBe(false);
    expect(memoryRateLimit("k1", 3, 1000, t0 + 1001)).toBe(true);
  });

  it("falls back to memory when Redis errors", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.invalid");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await rateLimit("k2", 1, 60_000)).toBe(true);
    expect(await rateLimit("k2", 1, 60_000)).toBe(false);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("uses the shared Redis counter when available", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ result: 6 }, { result: 0 }]), { status: 200 }),
    );
    expect(await rateLimit("k3", 5, 60_000)).toBe(false);
  });
});
