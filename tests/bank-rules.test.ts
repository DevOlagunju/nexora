import { describe, expect, it } from "vitest";
import { FALLBACK_BANKS, isAccountNumber, namesMatch } from "@/lib/bank-rules";
import { bankLookupSchema, kycSchema } from "@/lib/validators";

describe("namesMatch", () => {
  it("matches reordered bank names with extra middle names", () => {
    expect(namesMatch("OKAFOR ADAEZE CHIOMA", "Adaeze Okafor")).toBe(true);
    expect(namesMatch("BELLO, TUNDE A.", "Tunde Bello")).toBe(true);
  });
  it("ignores titles and punctuation", () => {
    expect(namesMatch("MRS ADA OKAFOR", "Ada Okafor")).toBe(true);
  });
  it("rejects a different person", () => {
    expect(namesMatch("EMEKA NWOSU", "Ada Okafor")).toBe(false);
    expect(namesMatch("ADA NWOSU", "Ada Okafor")).toBe(false);
  });
  it("single-name customers must match that name", () => {
    expect(namesMatch("TEMI ADEYEMI", "Temi")).toBe(true);
    expect(namesMatch("TOLU ADEYEMI", "Temi")).toBe(false);
  });
  it("empty input never matches", () => {
    expect(namesMatch("", "Ada Okafor")).toBe(false);
    expect(namesMatch("ADA OKAFOR", "")).toBe(false);
  });
});

describe("bank validation", () => {
  it("account numbers are 10 digits", () => {
    expect(isAccountNumber("0123456789")).toBe(true);
    expect(isAccountNumber("012345678")).toBe(false);
    expect(isAccountNumber("01234567a9")).toBe(false);
  });
  it("fallback bank codes are unique", () => {
    expect(new Set(FALLBACK_BANKS.map((b) => b.code)).size).toBe(FALLBACK_BANKS.length);
  });
  it("lookup schema needs a bank code and NUBAN", () => {
    expect(bankLookupSchema.safeParse({ bankCode: "058", accountNumber: "0123456789" }).success).toBe(true);
    expect(bankLookupSchema.safeParse({ bankCode: "", accountNumber: "0123456789" }).success).toBe(false);
  });
  it("KYC accepts a picked bank without a typed name, or the legacy typed form", () => {
    const base = { bvn: "12345678901", nin: "12345678901", accountNumber: "0123456789" };
    expect(kycSchema.safeParse({ ...base, bankCode: "058" }).success).toBe(true);
    expect(kycSchema.safeParse({ ...base, bankName: "GTBank", accountName: "Ada Okafor" }).success).toBe(true);
    expect(kycSchema.safeParse(base).success).toBe(false);
  });
});
