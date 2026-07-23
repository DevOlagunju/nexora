import { z } from "zod";

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

export const kycSchema = z.object({
  bvn: z.string().regex(/^\d{11}$/, "BVN must be 11 digits"),
  nin: z.string().regex(/^\d{11}$/, "NIN must be 11 digits"),
  bankName: z.string().trim().min(2).max(80),
  accountNumber: z.string().regex(/^\d{10}$/, "Account number must be 10 digits"),
  accountName: z.string().trim().min(2).max(80),
});

export const cryptoSellSchema = z.object({
  symbol: z.enum(["USDT", "BTC", "ETH"]),
  amountCrypto: z.coerce.number().positive(),
  txHash: z.string().trim().max(120).optional(),
});

export const cryptoBuySchema = z.object({
  symbol: z.enum(["USDT", "BTC", "ETH"]),
  amountCrypto: z.coerce.number().positive(),
  userReceiveAddress: z.string().trim().min(10).max(120),
  paymentRef: z.string().trim().max(120).optional(),
});

export const giftCardSellSchema = z.object({
  brand: z.enum(["APPLE", "STEAM", "AMAZON", "GOOGLE"]),
  country: z.string().trim().min(2).max(40).default("USA"),
  faceValueUsd: z.coerce.number().positive(),
  cardCode: z.string().trim().min(6).max(120),
});

export const rateUpdateSchema = z.object({
  id: z.string().min(1),
  sellRateNgn: z.coerce.number().positive(),
  buyRateNgn: z.coerce.number().positive(),
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
