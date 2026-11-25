import { z } from "zod";

/** Sell proceeds: Nexora wallet (default, withdraw any time) or straight to the KYC bank account. */
const payoutMethod = z.enum(["WALLET", "BANK"]).default("WALLET");

export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  phone: z
    .string()
    .trim()
    .regex(/^0[789][01]\d{8}$/, "Use a valid Nigerian phone (e.g. 08012345678)"),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(72)
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[0-9]/, "Include a number"),
  referralCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(16)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(72),
});

const strongPassword = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(72)
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[0-9]/, "Include a number");

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required").max(72),
    newPassword: strongPassword,
    confirmPassword: z.string().min(1).max(72),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: "New password must be different from the current one",
    path: ["newPassword"],
  });

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(120),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(20).max(200),
    newPassword: strongPassword,
    confirmPassword: z.string().min(1).max(72),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  });

export const kycSchema = z
  .object({
    bvn: z.string().regex(/^\d{11}$/, "BVN must be 11 digits"),
    nin: z.string().regex(/^\d{11}$/, "NIN must be 11 digits"),
    /** Preferred: bank picked from the list; the account name is then looked up, not typed. */
    bankCode: z.string().trim().regex(/^\d{3,6}$/, "Pick your bank from the list").optional(),
    bankName: z.string().trim().min(2).max(80).optional(),
    accountNumber: z.string().regex(/^\d{10}$/, "Account number must be 10 digits"),
    accountName: z.string().trim().min(2).max(80).optional(),
  })
  .refine((d) => d.bankCode || (d.bankName && d.accountName), {
    message: "Pick your bank and enter your account number",
    path: ["bankCode"],
  });

export const bankLookupSchema = z.object({
  bankCode: z.string().trim().regex(/^\d{3,6}$/, "Pick your bank from the list"),
  accountNumber: z.string().trim().regex(/^\d{10}$/, "Account number must be 10 digits"),
});

/**
 * Asset and brand codes are checked for shape only. Whether one is actually tradable comes
 * from the database (Rate and the asset/network registry), so admins add or remove assets
 * without a code change.
 */
const code = (label: string) =>
  z
    .string({ error: `Pick ${label}.` })
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{2,15}$/, `Pick ${label}.`));

/** Optional network code ("TRC20"). Without one, the asset's default network is used. */
const network = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9_-]{2,20}$/, "Pick a network."))
  .optional()
  .or(z.literal("").transform(() => undefined));

export const cryptoSellSchema = z.object({
  symbol: code("an asset"),
  network,
  amountCrypto: z.coerce.number().positive(),
  txHash: z.string().trim().max(120).optional(),
  payoutMethod,
});

/** The receive address is checked against the chosen network's format in the trade service. */
export const cryptoBuySchema = z.object({
  symbol: code("an asset"),
  network,
  amountCrypto: z.coerce.number().positive(),
  userReceiveAddress: z.string().trim().min(10, "Enter your wallet address").max(128),
  paymentRef: z
    .string()
    .trim()
    .max(120)
    // "wallet:" is reserved for money Nexora already holds; it drives refunds.
    .refine((v) => !v.toLowerCase().startsWith("wallet:"), "Enter your bank transfer reference.")
    .optional(),
  /** BANK: manual transfer to the desk. WALLET: debit the Nexora wallet now. CARD: gateway checkout, confirmed instantly. */
  payFrom: z.enum(["BANK", "WALLET", "CARD"]).default("BANK"),
});

export const giftCardSellSchema = z.object({
  brand: code("a gift card"),
  /** Country the card was issued in, as a code or name. Missing: the brand's default variant. */
  country: z.string().trim().max(40).optional(),
  /** "ECODE" or "PHYSICAL". Missing: the default variant's type for that country. */
  cardType: z.string().trim().max(20).optional(),
  faceValueUsd: z.coerce.number().positive(),
  cardCode: z.string().trim().min(6).max(120),
  payoutMethod,
});

/** Prices are required for crypto; a gift card brand only switches on or off (its prices are per variant). */
export const rateUpdateSchema = z.object({
  id: z.string().min(1),
  sellRateNgn: z.coerce.number().positive().optional(),
  buyRateNgn: z.coerce.number().positive().optional(),
  isActive: z.coerce.boolean().optional(),
});

export const orderStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum([
    "AWAITING_DEPOSIT",
    "UNDER_REVIEW",
    "APPROVED",
    "PAYOUT_SENT",
    "COMPLETED",
    "REJECTED",
    "CANCELLED",
  ]),
  adminNote: z.string().trim().max(500).optional(),
  payoutRef: z.string().trim().max(120).optional(),
  triggerPayout: z.coerce.boolean().optional(),
});
