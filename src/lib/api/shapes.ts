/** Field lists shared by v1 routes, so a sensitive column can never slip into a response. */

/** A gift card order as its owner may see it: everything except the card code. */
export const GIFT_ORDER_FIELDS = {
  id: true,
  reference: true,
  brand: true,
  country: true,
  faceValueUsd: true,
  rateNgn: true,
  amountNgn: true,
  status: true,
  adminNote: true,
  payoutMethod: true,
  payoutRef: true,
  createdAt: true,
  completedAt: true,
} as const;
