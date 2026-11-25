import { describe, expect, it } from "vitest";
import {
  denominationsProblem,
  faceValueProblem,
  normalizeCardType,
  normalizeCountry,
  parseDenominations,
  pickGiftVariant,
  type GiftVariant,
} from "@/lib/giftcard-rules";

describe("normalizeCountry", () => {
  it("turns the names older app versions send into ISO codes", () => {
    expect(["USA", "UK", "GERMANY", "CANADA"].map(normalizeCountry)).toEqual(["US", "GB", "DE", "CA"]);
  });
  it("accepts codes and names in any case and spacing", () => {
    expect(normalizeCountry("us")).toBe("US");
    expect(normalizeCountry("  united   kingdom ")).toBe("GB");
    expect(normalizeCountry("AU")).toBe("AU");
  });
  it("returns null for anything that cannot be a country", () => {
    expect(normalizeCountry("")).toBeNull();
    expect(normalizeCountry("Narnia")).toBeNull();
    expect(normalizeCountry(42)).toBeNull();
  });
});

describe("normalizeCardType", () => {
  it("understands the usual words", () => {
    expect(["ECODE", "e-code", "E code", "digital"].map(normalizeCardType)).toEqual(["ECODE", "ECODE", "ECODE", "ECODE"]);
    expect(["PHYSICAL", "physical", "card"].map(normalizeCardType)).toEqual(["PHYSICAL", "PHYSICAL", "PHYSICAL"]);
    expect(normalizeCardType("hologram")).toBeNull();
  });
});

describe("denominations", () => {
  it("parses a list, ignoring junk and duplicates, smallest first", () => {
    expect(parseDenominations("100, 25,50, 25")).toEqual([25, 50, 100]);
    expect(parseDenominations("")).toEqual([]);
    expect(parseDenominations(null)).toEqual([]);
  });
  it("tells the desk when a list is not usable", () => {
    expect(denominationsProblem("25, 50, 100")).toBeNull();
    expect(denominationsProblem("")).toBeNull();
    expect(denominationsProblem("25, fifty")).not.toBeNull();
    expect(denominationsProblem("0, 25")).not.toBeNull();
  });
});

const v = (over: Partial<GiftVariant> = {}): GiftVariant => ({
  country: "US",
  cardType: "ECODE",
  rateNgn: 1200,
  minFaceUsd: 25,
  maxFaceUsd: 500,
  denominations: null,
  isActive: true,
  isDefault: false,
  ...over,
});

describe("pickGiftVariant", () => {
  const variants = [
    v({ isDefault: true }),
    v({ cardType: "PHYSICAL", rateNgn: 1150 }),
    v({ country: "GB", rateNgn: 1100 }),
    v({ country: "GB", cardType: "PHYSICAL", rateNgn: 1050, isActive: false }),
    v({ country: "DE", cardType: "PHYSICAL", rateNgn: 900 }),
  ];
  const pick = (country?: unknown, cardType?: unknown) => pickGiftVariant("Amazon", variants, { country, cardType });

  it("uses the default variant when nothing is said", () => {
    const r = pick();
    expect(r.ok && [r.variant.country, r.variant.cardType]).toEqual(["US", "ECODE"]);
  });

  it("uses the named country and type", () => {
    const r = pick("USA", "physical");
    expect(r.ok && r.variant.rateNgn).toBe(1150);
  });

  it("takes the default's card type for a named country, as an older app expects", () => {
    const r = pick("UK");
    expect(r.ok && [r.variant.country, r.variant.cardType, r.variant.rateNgn]).toEqual(["GB", "ECODE", 1100]);
  });

  it("falls back to the only type offered for a country", () => {
    const r = pick("Germany");
    expect(r.ok && r.variant.cardType).toBe("PHYSICAL");
  });

  it("never uses a variant that is switched off", () => {
    const r = pick("GB", "PHYSICAL");
    expect(r).toEqual({ ok: false, error: "For UK Amazon we take: E-code." });
  });

  it("says which countries are bought when the card's country is not", () => {
    const r = pick("CA");
    expect(r).toEqual({ ok: false, error: "We're not buying Amazon gift cards from Canada right now. We buy: USA, UK, Germany." });
  });

  it("asks for a real country rather than guessing", () => {
    expect(pick("Narnia")).toEqual({ ok: false, error: "Pick the country the card is from." });
  });

  it("refuses a brand with nothing switched on", () => {
    expect(pickGiftVariant("Steam", [v({ isActive: false, isDefault: true })], {})).toEqual({
      ok: false,
      error: "We're not buying Steam gift cards right now.",
    });
  });
});

describe("faceValueProblem", () => {
  it("checks the range", () => {
    expect(faceValueProblem(v(), 100)).toBeNull();
    expect(faceValueProblem(v(), 10)).toBe("Minimum face value is $25.");
    expect(faceValueProblem(v(), 600)).toBe("Maximum face value is $500.");
    expect(faceValueProblem(v({ maxFaceUsd: null }), 5000)).toBeNull();
  });
  it("accepts only the listed values when there is a list", () => {
    const fixed = v({ denominations: "25, 50, 100" });
    expect(faceValueProblem(fixed, 50)).toBeNull();
    expect(faceValueProblem(fixed, 75)).toBe("This card is accepted in these values only: $25, $50, $100.");
  });
});
