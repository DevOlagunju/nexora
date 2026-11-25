import { describe, expect, it } from "vitest";
import { quoteConfig, quoteExpiry, quoteStatus, rateIsStale, secondsLeft } from "@/lib/quote-rules";

const cfg = quoteConfig({});
const T0 = new Date("2026-11-25T12:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe("quoteConfig", () => {
  it("has sane defaults and ignores junk or out-of-range values", () => {
    expect(cfg).toEqual({ ttlSeconds: 120, maxCryptoRateAgeMinutes: 360, maxGiftRateAgeMinutes: 10_080 });
    expect(quoteConfig({ QUOTE_TTL_SECONDS: "45" }).ttlSeconds).toBe(45);
    expect(quoteConfig({ QUOTE_TTL_SECONDS: "0" }).ttlSeconds).toBe(120);
    expect(quoteConfig({ QUOTE_TTL_SECONDS: "86400" }).ttlSeconds).toBe(120);
    expect(quoteConfig({ QUOTE_TTL_SECONDS: "soon" }).ttlSeconds).toBe(120);
  });
});

describe("quote lifetime", () => {
  const quote = { expiresAt: quoteExpiry(cfg, T0), acceptedAt: null };

  it("is open until the expiry and expired from that instant on", () => {
    expect(quoteStatus(quote, T0)).toBe("OPEN");
    expect(quoteStatus(quote, at(119))).toBe("OPEN");
    expect(quoteStatus(quote, at(120))).toBe("EXPIRED");
    expect(quoteStatus(quote, at(3600))).toBe("EXPIRED");
  });

  it("stays accepted once used, whatever the clock says", () => {
    expect(quoteStatus({ ...quote, acceptedAt: at(30) }, at(3600))).toBe("ACCEPTED");
  });

  it("counts down in whole seconds and never below zero", () => {
    expect(secondsLeft(quote, T0)).toBe(120);
    expect(secondsLeft(quote, at(119.4))).toBe(0);
    expect(secondsLeft(quote, at(60))).toBe(60);
    expect(secondsLeft(quote, at(500))).toBe(0);
  });
});

describe("rateIsStale", () => {
  it("refuses a crypto rate older than the limit, to the minute", () => {
    expect(rateIsStale("CRYPTO", at(-360 * 60), cfg, T0)).toBe(false);
    expect(rateIsStale("CRYPTO", at(-360 * 60 - 1), cfg, T0)).toBe(true);
  });

  it("allows gift card rates to be older, since they are set by hand", () => {
    const twoDaysAgo = at(-2 * 24 * 3600);
    expect(rateIsStale("CRYPTO", twoDaysAgo, cfg, T0)).toBe(true);
    expect(rateIsStale("GIFTCARD", twoDaysAgo, cfg, T0)).toBe(false);
    expect(rateIsStale("GIFTCARD", at(-8 * 24 * 3600), cfg, T0)).toBe(true);
  });
});
