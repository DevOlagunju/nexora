/**
 * Pure rules for gift card pricing. No I/O, unit tested (tests/giftcard-rules.test.ts).
 *
 * A gift card is priced by its variant: brand + country it was issued in + card type
 * (e-code or physical). Each variant has its own Naira rate per US dollar of face value,
 * limits, and optionally a fixed list of accepted face values.
 */

export const CARD_TYPES = ["ECODE", "PHYSICAL"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CARD_TYPE_LABEL: Record<CardType, string> = { ECODE: "E-code", PHYSICAL: "Physical card" };

/**
 * Names people and older app versions use for countries, mapped to ISO codes. Input
 * normalisation only: which countries the desk buys from is decided by the gift card rates.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  USA: "US",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  AMERICA: "US",
  UK: "GB",
  GBR: "GB",
  "UNITED KINGDOM": "GB",
  "GREAT BRITAIN": "GB",
  ENGLAND: "GB",
  GERMANY: "DE",
  DEU: "DE",
  CANADA: "CA",
  CAN: "CA",
  AUSTRALIA: "AU",
  AUS: "AU",
  FRANCE: "FR",
  FRA: "FR",
  SPAIN: "ES",
  ESP: "ES",
  ITALY: "IT",
  ITA: "IT",
};

export const COUNTRY_NAME: Record<string, string> = {
  US: "USA",
  GB: "UK",
  DE: "Germany",
  CA: "Canada",
  AU: "Australia",
  FR: "France",
  ES: "Spain",
  IT: "Italy",
};

export const countryName = (code: string) => COUNTRY_NAME[code] ?? code;

/** An ISO alpha-2 code for what the customer sent, or null when it cannot be one. */
export function normalizeCountry(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().toUpperCase().replace(/\s+/g, " ");
  if (!raw) return null;
  const code = COUNTRY_ALIASES[raw] ?? raw;
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function normalizeCardType(input: unknown): CardType | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().toUpperCase().replace(/[\s_-]+/g, "");
  if (raw === "ECODE" || raw === "DIGITAL" || raw === "CODE") return "ECODE";
  if (raw === "PHYSICAL" || raw === "CARD" || raw === "PLASTIC") return "PHYSICAL";
  return null;
}

/** "25, 50,100" -> [25, 50, 100]. Empty or null means any value is accepted. */
export function parseDenominations(raw: string | null | undefined): number[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(",").map((s) => Number(s.trim())))]
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}

/** Why `denominations` is not a usable list, or null. Used when the desk saves a variant. */
export function denominationsProblem(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => !/^\d+(\.\d{1,2})?$/.test(p) || Number(p) <= 0)) {
    return "Accepted values must be amounts separated by commas, e.g. 25, 50, 100.";
  }
  return null;
}

export type GiftVariant = {
  country: string;
  cardType: CardType;
  rateNgn: number;
  minFaceUsd: number;
  maxFaceUsd: number | null;
  denominations: string | null;
  isActive: boolean;
  isDefault: boolean;
};

/**
 * Which variant prices a card. Missing country or card type are taken from the brand's
 * default variant; if that card type is not offered for the country, the only one that is.
 */
export function pickGiftVariant<T extends GiftVariant>(
  brandLabel: string,
  variants: T[],
  request: { country?: unknown; cardType?: unknown },
): { ok: true; variant: T } | { ok: false; error: string } {
  const active = variants.filter((v) => v.isActive);
  const fallback = variants.find((v) => v.isDefault) ?? active[0];
  if (active.length === 0 || !fallback) return { ok: false, error: `We're not buying ${brandLabel} gift cards right now.` };

  const hasCountry = request.country !== undefined && request.country !== null && request.country !== "";
  const country = hasCountry ? normalizeCountry(request.country) : fallback.country;
  if (!country) return { ok: false, error: "Pick the country the card is from." };

  const forCountry = active.filter((v) => v.country === country);
  if (forCountry.length === 0) {
    const offered = [...new Set(active.map((v) => countryName(v.country)))].join(", ");
    return { ok: false, error: `We're not buying ${brandLabel} gift cards from ${countryName(country)} right now. We buy: ${offered}.` };
  }

  const hasType = request.cardType !== undefined && request.cardType !== null && request.cardType !== "";
  if (hasType) {
    const type = normalizeCardType(request.cardType);
    const match = type && forCountry.find((v) => v.cardType === type);
    if (match) return { ok: true, variant: match };
    const offered = forCountry.map((v) => CARD_TYPE_LABEL[v.cardType]).join(" or ");
    return { ok: false, error: `For ${countryName(country)} ${brandLabel} we take: ${offered}.` };
  }
  const chosen = forCountry.find((v) => v.cardType === fallback.cardType) ?? (forCountry.length === 1 ? forCountry[0] : undefined);
  if (chosen) return { ok: true, variant: chosen };
  return { ok: false, error: "Pick the card type: e-code or physical card." };
}

/** Why `faceUsd` cannot be sold on this variant, or null. */
export function faceValueProblem(variant: GiftVariant, faceUsd: number): string | null {
  if (!Number.isFinite(faceUsd) || faceUsd <= 0) return "Enter the card's face value.";
  const allowed = parseDenominations(variant.denominations);
  if (allowed.length > 0 && !allowed.includes(faceUsd)) {
    return `This card is accepted in these values only: ${allowed.map((v) => `$${v}`).join(", ")}.`;
  }
  if (faceUsd < variant.minFaceUsd) return `Minimum face value is $${variant.minFaceUsd}.`;
  if (variant.maxFaceUsd !== null && faceUsd > variant.maxFaceUsd) return `Maximum face value is $${variant.maxFaceUsd}.`;
  return null;
}
