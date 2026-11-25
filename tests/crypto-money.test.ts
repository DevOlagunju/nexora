import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hmacHex, maskSecret, orderReference, safeEqual } from "@/lib/crypto";
import { ngnToKobo, roundNgn } from "@/lib/money";
import { verifyPaystackSignature } from "@/lib/paystack";

describe("gift code encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("ABCD-1234-EFGH");
    const b = encryptSecret("ABCD-1234-EFGH");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decryptSecret(a.ciphertext, a.iv)).toBe("ABCD-1234-EFGH");
  });

  it("detects tampering via the GCM tag", () => {
    const sealed = encryptSecret("secret-code");
    const raw = Buffer.from(sealed.ciphertext, "base64");
    raw[0] ^= 0xff;
    expect(() => decryptSecret(raw.toString("base64"), sealed.iv)).toThrow();
  });

  it("masks all but the last characters", () => {
    expect(maskSecret("1234567890")).toBe("******7890");
    expect(maskSecret("abc")).toBe("****");
  });

  it("generates prefixed unique references", () => {
    const refs = new Set(Array.from({ length: 200 }, () => orderReference("NXC")));
    expect(refs.size).toBe(200);
    for (const r of refs) expect(r).toMatch(/^NXC-[A-Z0-9]+-[0-9A-F]{6}$/);
  });
});

describe("money", () => {
  it("rounds float noise to kobo precision", () => {
    expect(roundNgn(0.1 * 3 * 1380)).toBe(414);
    expect(roundNgn(1234.5600000000002)).toBe(1234.56);
    expect(roundNgn(1.005)).toBe(1.01);
  });

  it("converts NGN to integer kobo", () => {
    expect(ngnToKobo(1500.5)).toBe(150050);
    expect(Number.isInteger(ngnToKobo(0.1 + 0.2))).toBe(true);
  });
});

describe("signatures", () => {
  it("safeEqual matches only identical strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("verifies Paystack HMAC-SHA512 webhook signatures", () => {
    const body = JSON.stringify({ event: "transfer.success", data: { transfer_code: "TRF_1" } });
    const sig = hmacHex("sha512", "sk_test_key", body);
    expect(verifyPaystackSignature(body, sig, "sk_test_key")).toBe(true);
    expect(verifyPaystackSignature(body, sig, "sk_other")).toBe(false);
    expect(verifyPaystackSignature(body + " ", sig, "sk_test_key")).toBe(false);
    expect(verifyPaystackSignature(body, null, "sk_test_key")).toBe(false);
  });
});
