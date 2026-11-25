import { describe, expect, it } from "vitest";
import { addressProblem, explorerTxLink, pickAssetNetwork } from "@/lib/asset-rules";

// The same patterns the registry migration installs.
const TRC20 = { code: "TRC20", addressPattern: "^T[1-9A-HJ-NP-Za-km-z]{33}$", addressHint: "a Tron address" };
const ERC20 = { code: "ERC20", addressPattern: "^0x[0-9a-fA-F]{40}$", addressHint: "an Ethereum address" };
const BTC = {
  code: "BTC",
  addressPattern: "^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$",
  addressHint: "a Bitcoin address",
};

describe("addressProblem", () => {
  it("accepts well-formed addresses for the network", () => {
    expect(addressProblem("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", TRC20)).toBeNull();
    expect(addressProblem("0x52908400098527886E0F7030069857D2E4169EE7", ERC20)).toBeNull();
    expect(addressProblem("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", BTC)).toBeNull();
    expect(addressProblem("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", BTC)).toBeNull();
    expect(addressProblem("  TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE  ", TRC20)).toBeNull();
  });

  it("catches a wrong-network paste and names the network", () => {
    expect(addressProblem("0x52908400098527886E0F7030069857D2E4169EE7", TRC20)).toMatch(/TRC20/);
    expect(addressProblem("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", ERC20)).toMatch(/Ethereum address on ERC20/);
  });

  it("rejects empty, spaced and oversized input", () => {
    expect(addressProblem("", TRC20)).not.toBeNull();
    expect(addressProblem("TQn9Y2kh EsLJW1ChVWFMSMeRDow5KcbLSE", TRC20)).toMatch(/spaces/);
    expect(addressProblem("T".repeat(500), TRC20)).toMatch(/too long/);
  });

  it("refuses rather than accepts when a network's pattern is broken", () => {
    expect(addressProblem("anything-at-all-here", { code: "BAD", addressPattern: "([", addressHint: "x" })).toMatch(/cannot be checked/);
  });
});

describe("pickAssetNetwork", () => {
  const opt = (code: string, o: Partial<{ networkActive: boolean; depositsEnabled: boolean; withdrawalsEnabled: boolean; isDefault: boolean }> = {}) => ({
    code,
    networkActive: true,
    depositsEnabled: true,
    withdrawalsEnabled: true,
    isDefault: false,
    ...o,
  });

  it("uses the default network when none is named", () => {
    const r = pickAssetNetwork([opt("ERC20"), opt("TRC20", { isDefault: true })], "SELL");
    expect(r.ok && r.option.code).toBe("TRC20");
  });

  it("uses the named network, case-insensitively", () => {
    const r = pickAssetNetwork([opt("ERC20"), opt("TRC20", { isDefault: true })], "SELL", "erc20");
    expect(r.ok && r.option.code).toBe("ERC20");
  });

  it("falls back to the only usable network when the default cannot be used", () => {
    const r = pickAssetNetwork([opt("TRC20", { isDefault: true, depositsEnabled: false }), opt("BEP20")], "SELL");
    expect(r.ok && r.option.code).toBe("BEP20");
  });

  it("asks the customer to choose when several networks could be meant", () => {
    const r = pickAssetNetwork([opt("TRC20", { isDefault: true, depositsEnabled: false }), opt("BEP20"), opt("ERC20")], "SELL");
    expect(r).toEqual({ ok: false, error: "Choose a network: BEP20, ERC20." });
  });

  it("checks the direction: sells need deposits, buys need withdrawals", () => {
    const options = [opt("TRC20", { isDefault: true, withdrawalsEnabled: false })];
    expect(pickAssetNetwork(options, "SELL").ok).toBe(true);
    expect(pickAssetNetwork(options, "BUY").ok).toBe(false);
  });

  it("never uses a switched-off network, even when named", () => {
    const options = [opt("TRC20", { isDefault: true }), opt("ERC20", { networkActive: false })];
    const r = pickAssetNetwork(options, "SELL", "ERC20");
    expect(r).toEqual({ ok: false, error: "This asset is not available on ERC20 right now. Available: TRC20." });
  });

  it("says the asset is unavailable when nothing can be used", () => {
    expect(pickAssetNetwork([], "SELL")).toEqual({ ok: false, error: "This asset is not available right now." });
  });
});

describe("explorerTxLink", () => {
  it("fills in the hash", () => {
    expect(explorerTxLink("https://tronscan.org/#/transaction/{tx}", "abc123def456")).toBe("https://tronscan.org/#/transaction/abc123def456");
  });
  it("gives no link for odd input rather than a broken or injected one", () => {
    expect(explorerTxLink(null, "abc123def456")).toBeNull();
    expect(explorerTxLink("https://x/{tx}", null)).toBeNull();
    expect(explorerTxLink("https://x/{tx}", "abc\"><script>")).toBeNull();
  });
});
