/**
 * KYC provider adapter.
 * Wire Prembly / Dojah / YouVerify when keys are available.
 * Default: manual desk review (PENDING until admin approves).
 */

export type KycCheckInput = {
  bvn: string;
  nin: string;
  accountNumber: string;
  bankName: string;
  accountName: string;
};

export type KycCheckResult =
  | { mode: "manual"; status: "PENDING"; message: string }
  | { mode: "provider"; status: "APPROVED" | "REJECTED" | "PENDING"; message: string; providerRef?: string };

export async function verifyKycIdentity(input: KycCheckInput): Promise<KycCheckResult> {
  const provider = (process.env.KYC_PROVIDER ?? "manual").toLowerCase();
  const apiKey = process.env.KYC_API_KEY;

  if (provider === "manual" || !apiKey) {
    return {
      mode: "manual",
      status: "PENDING",
      message: "Submitted for desk review. Full BVN/NIN are not stored.",
    };
  }

  // Placeholder for Prembly/Dojah REST calls  -  do not send secrets to client.
  // Example flow: POST provider API with BVN/NIN, map response to APPROVED/REJECTED.
  void input;
  return {
    mode: "provider",
    status: "PENDING",
    message: `Provider '${provider}' queued verification. Configure KYC_API_KEY + endpoint to automate.`,
  };
}
