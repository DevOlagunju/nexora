import { Decimal } from "@prisma/client/runtime/index-browser";

/**
 * Money arithmetic. Amounts are exact DECIMAL in the database; in app code they travel
 * as plain numbers that are already rounded to the kobo. Any calculation on them goes
 * through these helpers, which do the work in decimal and round half-up once, so a
 * result never carries binary-float noise (0.1 + 0.2, 1.005 * 100, and so on).
 */

type Amount = number | string | Decimal;

const dec = (v: Amount) => new Decimal(v);
const kobo = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

/** Round to the kobo, half-up. */
export function roundNgn(amount: Amount): number {
  return kobo(dec(amount));
}

/** a * b in Naira, e.g. quantity x rate. */
export function mulNgn(a: Amount, b: Amount): number {
  return kobo(dec(a).times(b));
}

/** Sum of Naira amounts. */
export function sumNgn(amounts: Iterable<Amount>): number {
  let total = new Decimal(0);
  for (const a of amounts) total = total.plus(a);
  return kobo(total);
}

export function addNgn(a: Amount, b: Amount): number {
  return kobo(dec(a).plus(b));
}

export function subNgn(a: Amount, b: Amount): number {
  return kobo(dec(a).minus(b));
}

/** Whole kobo for payment providers. */
export function ngnToKobo(amount: Amount): number {
  return dec(amount).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/** Kobo from a payment provider back to Naira. */
export function koboToNgn(koboAmount: number): number {
  return kobo(dec(koboAmount).dividedBy(100));
}

/** A database aggregate (`_sum`) as a plain number; null means nothing matched. */
export function numberFrom(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}
