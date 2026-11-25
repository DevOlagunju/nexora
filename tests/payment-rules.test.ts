import { describe, expect, it } from "vitest";
import { fundingProblem, mapGatewayStatus, paymentConfig, settlementPlan } from "@/lib/payment-rules";

const cfg = paymentConfig({});

describe("paymentConfig", () => {
  it("has safe defaults and reads env overrides", () => {
    expect(cfg).toEqual({ minFundingNgn: 100, maxFundingNgn: 5_000_000, abandonAfterHours: 48 });
    expect(paymentConfig({ FUNDING_MIN_NGN: "500", FUNDING_MAX_NGN: "nope" }).minFundingNgn).toBe(500);
    expect(paymentConfig({ FUNDING_MAX_NGN: "nope" }).maxFundingNgn).toBe(5_000_000);
  });
});

describe("fundingProblem", () => {
  it("accepts amounts inside the limits", () => {
    expect(fundingProblem(100, cfg)).toBeNull();
    expect(fundingProblem(5_000_000, cfg)).toBeNull();
  });
  it("rejects empty, too small and too large", () => {
    expect(fundingProblem(Number.NaN, cfg)).toMatch(/Enter an amount/);
    expect(fundingProblem(0, cfg)).toMatch(/Enter an amount/);
    expect(fundingProblem(99, cfg)).toMatch(/Minimum/);
    expect(fundingProblem(5_000_001, cfg)).toMatch(/Maximum/);
  });
});

describe("mapGatewayStatus", () => {
  it("maps Paystack statuses", () => {
    expect(mapGatewayStatus("success")).toBe("success");
    expect(mapGatewayStatus("failed")).toBe("failed");
    expect(mapGatewayStatus("reversed")).toBe("failed");
    expect(mapGatewayStatus("abandoned")).toBe("abandoned");
  });
  it("treats unknown or in-flight statuses as pending, never success", () => {
    for (const s of ["ongoing", "pending", "processing", "queued", "", null, undefined, "SUCCESSFUL"]) {
      expect(mapGatewayStatus(s)).toBe("pending");
    }
    expect(mapGatewayStatus("SUCCESS")).toBe("success");
  });
});

describe("settlementPlan", () => {
  it("credits the verified amount for a wallet top-up", () => {
    expect(settlementPlan({ purpose: "WALLET_FUNDING", expectedNgn: 5000, paidNgn: 5000, currency: "NGN" })).toEqual({
      ok: true,
      creditNgn: 5000,
      fundsOrder: false,
      note: null,
    });
  });
  it("funds a buy order only when the payment covers it", () => {
    const full = settlementPlan({ purpose: "CRYPTO_BUY", expectedNgn: 150_000, paidNgn: 150_000, currency: "NGN" });
    expect(full).toMatchObject({ ok: true, fundsOrder: true, creditNgn: 150_000 });
    const short = settlementPlan({ purpose: "CRYPTO_BUY", expectedNgn: 150_000, paidNgn: 100_000, currency: "NGN" });
    expect(short).toMatchObject({ ok: true, fundsOrder: false, creditNgn: 100_000 });
    if (short.ok) expect(short.note).toMatch(/kept in wallet/);
  });
  it("rejects non-NGN and zero payments", () => {
    expect(settlementPlan({ purpose: "WALLET_FUNDING", expectedNgn: 5000, paidNgn: 5000, currency: "USD" }).ok).toBe(false);
    expect(settlementPlan({ purpose: "WALLET_FUNDING", expectedNgn: 5000, paidNgn: 0, currency: "NGN" }).ok).toBe(false);
  });
});
