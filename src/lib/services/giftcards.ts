import "server-only";
import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { writeAudit } from "@/lib/security";
import {
  denominationsProblem,
  normalizeCountry,
  parseDenominations,
  pickGiftVariant,
  type CardType,
} from "@/lib/giftcard-rules";
import { checkRateAlerts } from "@/lib/services/rate-alerts";
import { fail, ok, type ServiceResult } from "@/lib/services/result";

/**
 * Gift card rates: what the desk pays for each brand, from each country, of each card type,
 * per US dollar of face value. The brand (name, on/off) stays on Rate, and its headline rate
 * there is kept equal to the brand's default variant, so screens that show one rate per brand
 * show the default one.
 */

const VARIANT_SELECT = {
  id: true,
  brand: true,
  country: true,
  cardType: true,
  rateNgn: true,
  minFaceUsd: true,
  maxFaceUsd: true,
  denominations: true,
  isActive: true,
  isDefault: true,
  updatedAt: true,
} as const;

export type GiftVariantRow = NonNullable<Awaited<ReturnType<typeof variantById>>>;
const variantById = (id: string) => prisma.giftCardRate.findUnique({ where: { id }, select: VARIANT_SELECT });

export async function brandVariants(brand: string) {
  return prisma.giftCardRate.findMany({
    where: { brand },
    select: VARIANT_SELECT,
    orderBy: [{ isDefault: "desc" }, { country: "asc" }, { cardType: "asc" }],
  });
}

/**
 * The variant that prices a card, or why it cannot be sold. The brand must be on as well:
 * switching a brand off on the desk stops every variant of it.
 */
export async function resolveGiftVariant(
  brand: string,
  request: { country?: unknown; cardType?: unknown },
): Promise<ServiceResult<GiftVariantRow & { displayName: string }>> {
  const rate = await prisma.rate.findUnique({ where: { kind_symbol: { kind: "GIFTCARD", symbol: brand } } });
  if (!rate || !rate.isActive) return fail("This gift card is not available right now.");
  const picked = pickGiftVariant(rate.displayName, await brandVariants(brand), request);
  if (!picked.ok) return fail(picked.error, 422);
  return ok({ ...picked.variant, displayName: rate.displayName });
}

/** Active variants of active brands, for clients choosing country and card type. */
export async function listGiftCardBrands() {
  const [brands, variants] = await Promise.all([
    prisma.rate.findMany({ where: { kind: "GIFTCARD", isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.giftCardRate.findMany({
      where: { isActive: true },
      select: VARIANT_SELECT,
      orderBy: [{ isDefault: "desc" }, { country: "asc" }, { cardType: "asc" }],
    }),
  ]);
  return brands
    .map((b) => ({
      brand: b.symbol,
      displayName: b.displayName,
      variants: variants
        .filter((v) => v.brand === b.symbol)
        .map((v) => ({
          country: v.country,
          cardType: v.cardType,
          rateNgn: v.rateNgn,
          minFaceValueUsd: v.minFaceUsd,
          maxFaceValueUsd: v.maxFaceUsd,
          denominations: parseDenominations(v.denominations),
          isDefault: v.isDefault,
          updatedAt: v.updatedAt,
        })),
    }))
    .filter((b) => b.variants.length > 0);
}

export async function adminGiftCardRates() {
  const [brands, variants] = await Promise.all([
    prisma.rate.findMany({ where: { kind: "GIFTCARD" }, orderBy: { sortOrder: "asc" }, select: { symbol: true, displayName: true, isActive: true } }),
    prisma.giftCardRate.findMany({ select: VARIANT_SELECT, orderBy: [{ brand: "asc" }, { isDefault: "desc" }, { country: "asc" }, { cardType: "asc" }] }),
  ]);
  return { brands, variants };
}

/** Copies the brand's default variant onto its Rate row (the headline rate and limits). */
async function syncBrandHeadline(tx: Db, brand: string) {
  const def = await tx.giftCardRate.findFirst({ where: { brand, isDefault: true } });
  if (!def) return;
  await tx.rate.update({
    where: { kind_symbol: { kind: "GIFTCARD", symbol: brand } },
    data: { sellRateNgn: def.rateNgn, minAmount: def.minFaceUsd, maxAmount: def.maxFaceUsd },
  });
}

// ---------------------------------------------------------------- admin changes

type Admin = { id: string };

const flag = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());
const money = (label: string) => z.coerce.number({ error: `Enter ${label}.` }).positive(`${label[0].toUpperCase()}${label.slice(1)} must be above 0.`);
const optionalMoney = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().positive().nullable());
const denoms = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().max(200).nullable());

const variantFields = {
  rateNgn: money("the rate"),
  minFaceUsd: money("the minimum face value"),
  maxFaceUsd: optionalMoney,
  denominations: denoms,
};

const updateSchema = z.object({ id: z.string().min(1), ...variantFields, isActive: flag, isDefault: flag });
const addSchema = z.object({
  brand: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{2,15}$/, "Pick a brand.")),
  country: z.string(),
  cardType: z.enum(["ECODE", "PHYSICAL"], { error: "Pick a card type." }),
  ...variantFields,
});

function variantProblem(d: { minFaceUsd: number; maxFaceUsd: number | null; denominations: string | null }): string | null {
  if (d.maxFaceUsd !== null && d.maxFaceUsd < d.minFaceUsd) return "Maximum face value must be at least the minimum.";
  return denominationsProblem(d.denominations);
}

const snapshot = (v: { rateNgn: number; minFaceUsd: number; maxFaceUsd: number | null; denominations: string | null; isActive: boolean; isDefault: boolean }) => ({
  rateNgn: v.rateNgn,
  minFaceUsd: v.minFaceUsd,
  maxFaceUsd: v.maxFaceUsd,
  denominations: v.denominations,
  isActive: v.isActive,
  isDefault: v.isDefault,
});

/** Change one variant's price, limits, accepted values, on/off or default. Audited with old and new values. */
export async function updateGiftCardRate(admin: Admin, input: unknown): Promise<ServiceResult<null>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const d = parsed.data;
  const problem = variantProblem(d);
  if (problem) return fail(problem, 422);

  const before = await variantById(d.id);
  if (!before) return fail("Not found.", 404);
  if (before.isDefault && !d.isDefault) {
    return fail("Every brand needs a default. Make another variant the default instead.", 409);
  }
  if (d.isDefault && !d.isActive) return fail("The default variant must be on.", 422);

  await prisma.$transaction(async (tx) => {
    if (d.isDefault && !before.isDefault) {
      await tx.giftCardRate.updateMany({ where: { brand: before.brand, isDefault: true }, data: { isDefault: false } });
    }
    await tx.giftCardRate.update({
      where: { id: d.id },
      data: {
        rateNgn: d.rateNgn,
        minFaceUsd: d.minFaceUsd,
        maxFaceUsd: d.maxFaceUsd,
        denominations: d.denominations,
        isActive: d.isActive,
        isDefault: d.isDefault,
      },
    });
    await syncBrandHeadline(tx, before.brand);
  });

  // Rate history lives in the audit log: every change records what it was and what it became.
  await writeAudit("admin.giftcard_rate_update", {
    userId: admin.id,
    meta: { brand: before.brand, country: before.country, cardType: before.cardType, from: snapshot(before), to: snapshot(d) },
  });
  const fired = await checkRateAlerts();
  return ok(null, `${before.brand} ${before.country} ${before.cardType === "ECODE" ? "e-code" : "physical"} saved.${fired ? ` ${fired} customer alert${fired === 1 ? "" : "s"} sent.` : ""}`);
}

/** Price a new country or card type for a brand. It starts switched off. */
export async function addGiftCardRate(admin: Admin, input: unknown): Promise<ServiceResult<null>> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const d = parsed.data;
  const country = normalizeCountry(d.country);
  if (!country) return fail("Enter the country as a 2-letter code (e.g. US, GB) or its name.", 422);
  const problem = variantProblem(d);
  if (problem) return fail(problem, 422);

  const brand = await prisma.rate.findUnique({ where: { kind_symbol: { kind: "GIFTCARD", symbol: d.brand } } });
  if (!brand) return fail("Unknown brand.", 422);
  const hasDefault = (await prisma.giftCardRate.count({ where: { brand: d.brand, isDefault: true } })) > 0;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.giftCardRate.create({
        data: {
          brand: d.brand,
          country,
          cardType: d.cardType as CardType,
          rateNgn: d.rateNgn,
          minFaceUsd: d.minFaceUsd,
          maxFaceUsd: d.maxFaceUsd,
          denominations: d.denominations,
          // A brand's first variant must be usable, since it becomes the default.
          isActive: !hasDefault,
          isDefault: !hasDefault,
        },
      });
      if (!hasDefault) await syncBrandHeadline(tx, d.brand);
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return fail(`${d.brand} ${country} ${d.cardType} already has a rate.`, 409);
    throw err;
  }

  await writeAudit("admin.giftcard_rate_add", {
    userId: admin.id,
    meta: { brand: d.brand, country, cardType: d.cardType, rateNgn: d.rateNgn, minFaceUsd: d.minFaceUsd, maxFaceUsd: d.maxFaceUsd },
  });
  return ok(null, hasDefault ? `${d.brand} ${country} added, switched off. Check the price, then switch it on.` : `${d.brand} ${country} added as the brand's default.`);
}
