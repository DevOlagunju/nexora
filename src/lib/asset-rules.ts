/**
 * Pure rules for the asset and network registry. No I/O, unit tested (tests/asset-rules.test.ts).
 * The data (which assets, which networks, address formats) lives in the database and is
 * managed by admins; nothing here names a specific asset or network.
 */

export type NetworkRule = { code: string; addressPattern: string; addressHint: string };

const MAX_ADDRESS_LENGTH = 128;

/** Why `address` is not a valid address on `network`, or null when it looks right. */
export function addressProblem(address: string, network: NetworkRule): string | null {
  const a = address.trim();
  if (!a) return "Enter a wallet address.";
  if (/\s/.test(a)) return "Wallet address cannot contain spaces.";
  if (a.length > MAX_ADDRESS_LENGTH) return "That wallet address is too long.";
  let pattern: RegExp;
  try {
    pattern = new RegExp(network.addressPattern);
  } catch {
    // A broken pattern is a configuration fault: refuse rather than accept anything.
    return `Addresses on ${network.code} cannot be checked right now. Contact support.`;
  }
  return pattern.test(a) ? null : `That doesn't look like ${network.addressHint} on ${network.code}.`;
}

export type AssetNetworkOption = {
  code: string;
  networkActive: boolean;
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
  isDefault: boolean;
};

/**
 * Which network an order uses. A sell needs deposits enabled (the customer sends to us);
 * a buy needs withdrawals enabled (we send to the customer).
 * With no network named: the asset's default if it is usable, else the only usable one.
 */
export function pickAssetNetwork<T extends AssetNetworkOption>(
  options: T[],
  side: "SELL" | "BUY",
  requested?: string | null,
): { ok: true; option: T } | { ok: false; error: string } {
  const usable = options.filter((o) => o.networkActive && (side === "SELL" ? o.depositsEnabled : o.withdrawalsEnabled));
  if (usable.length === 0) return { ok: false, error: "This asset is not available right now." };

  const want = requested?.trim().toUpperCase();
  if (want) {
    const match = usable.find((o) => o.code === want);
    if (match) return { ok: true, option: match };
    return {
      ok: false,
      error: `This asset is not available on ${want} right now. Available: ${usable.map((o) => o.code).join(", ")}.`,
    };
  }
  const chosen = usable.find((o) => o.isDefault) ?? (usable.length === 1 ? usable[0] : undefined);
  if (chosen) return { ok: true, option: chosen };
  return { ok: false, error: `Choose a network: ${usable.map((o) => o.code).join(", ")}.` };
}

/** A transaction link for a network's explorer, or null when the network has none. */
export function explorerTxLink(template: string | null | undefined, txHash: string | null | undefined): string | null {
  if (!template || !txHash || !/^[A-Za-z0-9]{8,128}$/.test(txHash.trim())) return null;
  return template.replace("{tx}", encodeURIComponent(txHash.trim()));
}
