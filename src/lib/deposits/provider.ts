import "server-only";
import { randomBytes } from "node:crypto";
import { hmacHex, safeEqual } from "@/lib/crypto";
import { simulatedAddress } from "@/lib/deposit-rules";
import { shkeeperConfig, shkeeperProvider } from "@/lib/deposits/shkeeper";

/**
 * Deposit providers: whoever issues customer deposit addresses and tells Nexora when crypto
 * arrives (SHKeeper today; Blockradar, Fireblocks and others can be added the same way). Everything else (matching deposits to orders,
 * confirmations, exceptions) is provider-neutral, in src/lib/services/deposits.ts.
 */

/** One transfer the provider reports. Reported again as confirmations grow; `dropped` when it left the chain. */
export type DepositEvent = {
  eventId: string;
  network: string;
  symbol: string;
  txHash: string;
  txIndex: string;
  toAddress: string;
  fromAddress?: string | null;
  amount: number;
  confirmations: number;
  dropped?: boolean;
  /** The provider vouches the transfer is final (it reports no count), e.g. SHKeeper's CONFIRMED. */
  confirmed?: boolean;
  /** The provider's own reference for the address (SHKeeper: the invoice external_id). */
  providerRef?: string | null;
  /** The provider's name for the coin (SHKeeper: "ETH-USDT"). */
  providerCoin?: string | null;
};

export interface DepositProvider {
  readonly name: string;
  /** HTTP status a handled webhook answers with (SHKeeper wants 202). Default 200. */
  readonly successStatus?: number;
  createAddress(input: { userId: string; symbol: string; networkCode: string }): Promise<{
    address: string;
    memo?: string | null;
    providerRef?: string | null;
  }>;
  /** True when the webhook really came from the provider. */
  verifyWebhook(rawBody: string, headers: Pick<Headers, "get">): boolean;
  parseWebhook(rawBody: string): DepositEvent[];
  /**
   * Optional second check before an event is acted on: ask the provider's API about it. Returns the
   * event as the provider sees it, or throws (the webhook then fails and the provider retries).
   */
  confirmEvent?(event: DepositEvent): Promise<DepositEvent>;
}

// ---------------------------------------------------------------- simulated (local testing only)

const SIM_SIGNATURE_HEADER = "x-simulated-signature";

function simulatedSecret() {
  return process.env.SIMULATED_DEPOSIT_SECRET?.trim() || "nexora-simulated-deposits-local-only";
}

/** Signs a simulated webhook body the way the simulated provider expects. */
export function signSimulatedWebhook(rawBody: string): Record<string, string> {
  return { "content-type": "application/json", [SIM_SIGNATURE_HEADER]: hmacHex("sha256", simulatedSecret(), rawBody) };
}

const simulated: DepositProvider = {
  name: "simulated",
  async createAddress(input) {
    return { address: simulatedAddress(input.networkCode, randomBytes(48)), providerRef: `sim-${input.userId}-${input.symbol}` };
  },
  verifyWebhook(rawBody, headers) {
    const sig = headers.get(SIM_SIGNATURE_HEADER);
    return !!sig && safeEqual(hmacHex("sha256", simulatedSecret(), rawBody), sig.trim().toLowerCase());
  },
  parseWebhook(rawBody) {
    const body = JSON.parse(rawBody) as { events?: DepositEvent[] };
    if (!Array.isArray(body.events)) throw new Error("Expected { events: [...] }");
    return body.events.map((e) => ({
      eventId: String(e.eventId),
      network: String(e.network).toUpperCase(),
      symbol: String(e.symbol).toUpperCase(),
      txHash: String(e.txHash),
      txIndex: String(e.txIndex ?? "0"),
      toAddress: String(e.toAddress),
      fromAddress: e.fromAddress ? String(e.fromAddress) : null,
      amount: Number(e.amount),
      confirmations: Math.max(0, Math.floor(Number(e.confirmations) || 0)),
      dropped: e.dropped === true,
    }));
  },
};

/** The simulated provider never runs in production: it would credit deposits that never happened. */
export function simulatedDepositsAllowed() {
  return process.env.NODE_ENV !== "production";
}

function shkeeper(): DepositProvider | null {
  const cfg = shkeeperConfig();
  return cfg ? shkeeperProvider(cfg) : null;
}

/**
 * The provider for new deposit addresses, or null for none (orders then use the desk's shared
 * deposit address from the registry, as before). DEPOSIT_PROVIDER picks it:
 *   shkeeper   self-hosted SHKeeper (needs SHKEEPER_URL, SHKEEPER_API_KEY, NEXT_PUBLIC_APP_URL)
 *   simulated  free local testing; the default outside production, refused in production
 *   none       off
 */
export function activeDepositProvider(): DepositProvider | null {
  const wanted = (process.env.DEPOSIT_PROVIDER ?? "").trim().toLowerCase();
  if (wanted === "none") return null;
  if (wanted === "shkeeper") return shkeeper();
  if ((wanted === "simulated" || wanted === "") && simulatedDepositsAllowed()) return simulated;
  return null;
}

/**
 * The provider a webhook claims to come from, or null when it isn't one Nexora uses. A configured
 * SHKeeper keeps receiving callbacks even after DEPOSIT_PROVIDER moves away from it, so deposits to
 * addresses already handed out are still seen.
 */
export function depositProviderNamed(name: string): DepositProvider | null {
  if (name === "simulated" && simulatedDepositsAllowed()) return simulated;
  if (name === "shkeeper") return shkeeper();
  return null;
}
