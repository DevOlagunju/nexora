import { describe, expect, it } from "vitest";
import { classifyAmount, depositConfig, normalizeAddress, pickOrderForDeposit, simulatedAddress } from "@/lib/deposit-rules";

describe("classifyAmount", () => {
  it("allows a small tolerance either way", () => {
    expect(classifyAmount(100, 100, 0.1)).toBe("EXACT");
    expect(classifyAmount(100, 99.95, 0.1)).toBe("EXACT");
    expect(classifyAmount(100, 99.8, 0.1)).toBe("UNDER");
    expect(classifyAmount(100, 100.2, 0.1)).toBe("OVER");
    expect(classifyAmount(100, 99.99, 0)).toBe("UNDER");
  });
});

describe("depositConfig", () => {
  it("defaults to 0.1% and ignores nonsense", () => {
    expect(depositConfig({}).amountTolerancePct).toBe(0.1);
    expect(depositConfig({ DEPOSIT_AMOUNT_TOLERANCE_PCT: "1" }).amountTolerancePct).toBe(1);
    expect(depositConfig({ DEPOSIT_AMOUNT_TOLERANCE_PCT: "-1" }).amountTolerancePct).toBe(0.1);
    expect(depositConfig({ DEPOSIT_AMOUNT_TOLERANCE_PCT: "50" }).amountTolerancePct).toBe(0.1);
  });
});

describe("pickOrderForDeposit", () => {
  const order = (id: string, amountCrypto: number, minutesAgo: number) => ({ id, amountCrypto, createdAt: new Date(Date.now() - minutesAgo * 60_000) });

  it("prefers the oldest order whose amount matches", () => {
    const orders = [order("newer-50", 50, 1), order("old-100", 100, 30), order("older-50", 50, 60)];
    expect(pickOrderForDeposit(orders, 50, 0.1)?.id).toBe("older-50");
    expect(pickOrderForDeposit(orders, 100, 0.1)?.id).toBe("old-100");
  });

  it("falls back to the oldest when no amount matches, and to none when there are no orders", () => {
    expect(pickOrderForDeposit([order("a", 10, 1), order("b", 20, 5)], 15, 0.1)?.id).toBe("b");
    expect(pickOrderForDeposit([], 15, 0.1)).toBeNull();
  });
});

describe("addresses", () => {
  it("compares EVM addresses without case, and leaves others alone", () => {
    expect(normalizeAddress(" 0xAbCDEF0123456789abcdef0123456789ABCDEF01 ")).toBe("0xabcdef0123456789abcdef0123456789abcdef01");
    expect(normalizeAddress("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE")).toBe("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE");
  });

  it("simulated addresses have the shape of their network, so the network's own checks accept them", () => {
    const bytes = new Uint8Array(48).map((_, i) => (i * 37) % 256);
    expect(simulatedAddress("TRC20", bytes)).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(simulatedAddress("ERC20", bytes)).toMatch(/^0x[0-9a-f]{40}$/);
    expect(simulatedAddress("BEP20", bytes)).toMatch(/^0x[0-9a-f]{40}$/);
    expect(simulatedAddress("BTC", bytes)).toMatch(/^bc1[02-9ac-hj-np-z]{11,71}$/);
  });
});
