/** NGN bank account customers pay into when buying crypto. */
export function platformBankDetails() {
  return {
    bankName: process.env.PLATFORM_BANK_NAME?.trim() || "Nexora Desk",
    accountNumber: process.env.PLATFORM_BANK_ACCOUNT?.trim() || "0000000000",
    accountName: process.env.PLATFORM_BANK_ACCOUNT_NAME?.trim() || "Nexora Limited",
  };
}
