/** Pure bank helpers (unit tested in tests/bank-rules.test.ts). */

export type Bank = { name: string; code: string };

/**
 * Used when Paystack isn't configured (local dev) or its bank list is unreachable.
 * Codes are Paystack bank codes. With Paystack configured, the live list replaces this.
 */
export const FALLBACK_BANKS: Bank[] = [
  { name: "Access Bank", code: "044" },
  { name: "Citibank Nigeria", code: "023" },
  { name: "Ecobank Nigeria", code: "050" },
  { name: "Fidelity Bank", code: "070" },
  { name: "First Bank of Nigeria", code: "011" },
  { name: "First City Monument Bank", code: "214" },
  { name: "Globus Bank", code: "00103" },
  { name: "Guaranty Trust Bank", code: "058" },
  { name: "Heritage Bank", code: "030" },
  { name: "Jaiz Bank", code: "301" },
  { name: "Keystone Bank", code: "082" },
  { name: "Kuda Bank", code: "50211" },
  { name: "Moniepoint MFB", code: "50515" },
  { name: "OPay", code: "999992" },
  { name: "PalmPay", code: "999991" },
  { name: "Polaris Bank", code: "076" },
  { name: "Providus Bank", code: "101" },
  { name: "Stanbic IBTC Bank", code: "221" },
  { name: "Standard Chartered Bank", code: "068" },
  { name: "Sterling Bank", code: "232" },
  { name: "SunTrust Bank", code: "100" },
  { name: "Union Bank of Nigeria", code: "032" },
  { name: "United Bank For Africa", code: "033" },
  { name: "Unity Bank", code: "215" },
  { name: "VFD Microfinance Bank", code: "566" },
  { name: "Wema Bank", code: "035" },
  { name: "Zenith Bank", code: "057" },
];

const STOP = new Set(["MR", "MRS", "MS", "MISS", "DR", "CHIEF", "ALHAJI", "ALHAJA", "ENGR", "PASTOR"]);

function nameTokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/**
 * Does the bank's account name plausibly belong to this customer?
 * Banks reorder names (SURNAME FIRST MIDDLE) and add middle names, so we compare tokens,
 * not strings: two shared names, or every name the customer gave when they gave fewer than two.
 */
export function namesMatch(accountName: string, fullName: string): boolean {
  const bank = new Set(nameTokens(accountName));
  const mine = nameTokens(fullName);
  if (bank.size === 0 || mine.length === 0) return false;
  const shared = mine.filter((t) => bank.has(t)).length;
  return mine.length >= 2 ? shared >= 2 : shared === mine.length;
}

export function isAccountNumber(v: string) {
  return /^\d{10}$/.test(v);
}
