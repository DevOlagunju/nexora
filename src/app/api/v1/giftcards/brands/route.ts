import { listGiftCardBrands } from "@/lib/services/giftcards";
import { data, open } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/giftcards/brands  Gift card brands the desk is buying.
 *
 * Each brand lists its `variants`: one per country (ISO code, e.g. "US", "GB") and card type
 * ("ECODE" or "PHYSICAL"), with the Naira rate per $1 of face value, limits, and the accepted
 * face values (empty means any value in range). Send `country` and `cardType` with a quote or
 * order; without them the variant marked `isDefault` is used.
 *
 * The brand-level fields (`sellRateNgn`, `minFaceValueUsd`, `maxFaceValueUsd`) are the default
 * variant's, kept for clients that show one rate per brand.
 */
export const GET = open(async () => {
  const brands = await listGiftCardBrands();
  return data(
    brands.map((b) => {
      const def = b.variants.find((v) => v.isDefault) ?? b.variants[0];
      return {
        brand: b.brand,
        displayName: b.displayName,
        sellRateNgn: def.rateNgn,
        minFaceValueUsd: def.minFaceValueUsd,
        maxFaceValueUsd: def.maxFaceValueUsd,
        updatedAt: def.updatedAt,
        variants: b.variants,
      };
    }),
  );
});
