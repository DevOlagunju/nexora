/**
 * Pure rules for blockchain deposits. No I/O, unit tested (tests/deposit-rules.test.ts).
 */

export type DepositConfig = {
  /** How far a deposit may differ from the order amount and still count as exact, in percent. */
  amountTolerancePct: number;
};

export function depositConfig(env: Record<string, string | undefined> = process.env): DepositConfig {
  const n = Number(env.DEPOSIT_AMOUNT_TOLERANCE_PCT);
  return { amountTolerancePct: Number.isFinite(n) && n >= 0 && n <= 5 ? n : 0.1 };
}

export type AmountMatch = "EXACT" | "UNDER" | "OVER";

/** Is the received amount what the order expected, within the tolerance? */
export function classifyAmount(expected: number, received: number, tolerancePct: number): AmountMatch {
  const slack = (expected * tolerancePct) / 100;
  if (received < expected - slack) return "UNDER";
  if (received > expected + slack) return "OVER";
  return "EXACT";
}

export type OpenOrder = { id: string; amountCrypto: number; createdAt: Date };

/**
 * Which of a customer's open sell orders a deposit pays: the oldest whose amount matches, else
 * the oldest. Null when there is none (the deposit is then unmatched).
 */
export function pickOrderForDeposit<T extends OpenOrder>(orders: T[], amount: number, tolerancePct: number): T | null {
  const oldestFirst = [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return oldestFirst.find((o) => classifyAmount(o.amountCrypto, amount, tolerancePct) === "EXACT") ?? oldestFirst[0] ?? null;
}

/** EVM addresses are case-insensitive (the case is only a checksum); others are case-sensitive. */
export function normalizeAddress(address: string): string {
  const a = address.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : a;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BECH32 = "023456789acdefghjklmnpqrsuvwxyz";
const HEX = "0123456789abcdef";

/**
 * A made-up address that has the right shape for the network, for the simulated provider used in
 * local testing. It belongs to nobody: never send real funds to it.
 */
export function simulatedAddress(networkCode: string, randomBytes: Uint8Array): string {
  const pick = (alphabet: string, length: number) =>
    Array.from({ length }, (_, i) => alphabet[randomBytes[i % randomBytes.length] % alphabet.length]).join("");
  switch (networkCode) {
    case "TRC20":
      return `T${pick(BASE58, 33)}`;
    case "ERC20":
    case "BEP20":
      return `0x${pick(HEX, 40)}`;
    case "BTC":
      return `bc1q${pick(BECH32, 38)}`;
    default:
      return `SIM${pick(BASE58, 30)}`;
  }
}
