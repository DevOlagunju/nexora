import { describe, expect, it } from "vitest";
import {
  isPayoutLock,
  newPayoutLock,
  PAYOUT_NOT_FOUND_GRACE_MS,
  payoutLockAgeMs,
  payoutVerdict,
} from "@/lib/payout-rules";
import {
  mapTransferStatus,
  PaystackError,
  referenceFromTransfer,
  transferOutcomeUnknown,
  transferReference,
} from "@/lib/paystack";

describe("payout lock", () => {
  it("round-trips its age and ignores real transfer codes", () => {
    const lock = newPayoutLock("admin1", 1_000_000);
    expect(isPayoutLock(lock)).toBe(true);
    expect(payoutLockAgeMs(lock, 1_060_000)).toBe(60_000);
    expect(isPayoutLock("TRF_abc")).toBe(false);
    expect(payoutLockAgeMs("TRF_abc")).toBeNull();
    expect(payoutLockAgeMs(null)).toBeNull();
  });
});

describe("payoutVerdict", () => {
  const T0 = 1_000_000;
  const lock = newPayoutLock("admin1", T0);

  it("follows a definite Paystack answer", () => {
    expect(payoutVerdict({ state: "success", payoutRef: lock })).toBe("paid");
    expect(payoutVerdict({ state: "pending", payoutRef: lock })).toBe("in_flight");
    expect(payoutVerdict({ state: "failed", payoutRef: "TRF_abc" })).toBe("failed");
  });

  it("does not call a missing transfer 'never sent' until the grace period has passed", () => {
    expect(payoutVerdict({ state: "not_found", payoutRef: lock, now: T0 + PAYOUT_NOT_FOUND_GRACE_MS - 1 })).toBe("wait");
    expect(payoutVerdict({ state: "not_found", payoutRef: lock, now: T0 + PAYOUT_NOT_FOUND_GRACE_MS })).toBe("never_sent");
  });

  it("never auto-releases a lock it cannot date", () => {
    expect(payoutVerdict({ state: "not_found", payoutRef: "pending:admin1:garbage", now: T0 * 1000 })).toBe("wait");
  });

  it("never releases a payout that already has a transfer code", () => {
    expect(payoutVerdict({ state: "not_found", payoutRef: "TRF_abc", now: 10 * PAYOUT_NOT_FOUND_GRACE_MS })).toBe("wait");
  });
});

describe("transfer references", () => {
  it("maps a Nexora reference to a Paystack reference and back", () => {
    const ref = "NXW-MB7K2Q1A-9F3C1D";
    expect(transferReference(ref)).toBe(`nxp-${ref}`);
    expect(referenceFromTransfer(transferReference(ref))).toBe(ref);
  });

  it("ignores references that are not ours", () => {
    expect(referenceFromTransfer("some-dashboard-transfer")).toBeNull();
    expect(referenceFromTransfer(undefined)).toBeNull();
  });
});

describe("transferOutcomeUnknown", () => {
  it("is unknown when no usable response came back", () => {
    expect(transferOutcomeUnknown(new PaystackError("Paystack did not respond in time", 0))).toBe(true);
    expect(transferOutcomeUnknown(new PaystackError("Bad gateway", 502))).toBe(true);
    expect(transferOutcomeUnknown(new Error("socket hang up"))).toBe(true);
  });

  it("is unknown when the reference was already used: an earlier attempt got through", () => {
    expect(transferOutcomeUnknown(new PaystackError("Please provide a unique reference. Reference already exists", 400))).toBe(true);
  });

  it("is a definite no for a clean rejection", () => {
    expect(transferOutcomeUnknown(new PaystackError("Your balance is not enough to fulfil this request", 400))).toBe(false);
    expect(transferOutcomeUnknown(new PaystackError("Invalid key", 401))).toBe(false);
  });
});

describe("mapTransferStatus", () => {
  it("only reports success or failure when Paystack is explicit", () => {
    expect(mapTransferStatus("success")).toBe("success");
    expect(mapTransferStatus("reversed")).toBe("failed");
    expect(mapTransferStatus("failed")).toBe("failed");
    expect(mapTransferStatus("otp")).toBe("pending");
    expect(mapTransferStatus("something-new")).toBe("pending");
    expect(mapTransferStatus(undefined)).toBe("pending");
  });
});
