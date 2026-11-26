import { describe, expect, it } from "vitest";
import {
  bucketIndex,
  buckets,
  compactNgn,
  formatPct,
  lagosMidnight,
  parseRange,
  parseSeen,
  pctChange,
  successRate,
  unseenIds,
} from "@/lib/admin-overview-rules";

describe("bell: seen and unseen work", () => {
  it("counts only what has not been seen", () => {
    const ids = ["crypto-1", "kyc-2", "withdrawal-3"];
    expect(unseenIds(ids, new Set())).toEqual(ids);
    expect(unseenIds(ids, new Set(["crypto-1", "kyc-2", "withdrawal-3"]))).toEqual([]);
    // A new order arrives after the bell was opened: only that one is new.
    expect(unseenIds([...ids, "crypto-9"], new Set(ids))).toEqual(["crypto-9"]);
    // Handled work drops out of the list and never comes back as "new".
    expect(unseenIds(["kyc-2"], new Set(ids))).toEqual([]);
  });

  it("reads the stored list, and treats anything broken as nothing seen", () => {
    expect([...parseSeen('["a","b"]')]).toEqual(["a", "b"]);
    expect([...parseSeen('["a",3,null]')]).toEqual(["a"]);
    expect(parseSeen(null).size).toBe(0);
    expect(parseSeen("not json").size).toBe(0);
    expect(parseSeen('{"a":1}').size).toBe(0);
  });
});

const NOW = new Date("2026-11-25T15:30:00Z"); // 16:30 in Lagos

describe("overview ranges and buckets", () => {
  it("falls back to 30 days for anything unknown", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("1y")).toBe("1y");
    expect(parseRange("forever")).toBe("30d");
    expect(parseRange(undefined)).toBe("30d");
  });

  it("cuts days at Lagos midnight, not UTC midnight", () => {
    // 23:30 UTC on the 24th is 00:30 on the 25th in Lagos.
    expect(lagosMidnight(new Date("2026-11-24T23:30:00Z")).toISOString()).toBe("2026-11-24T23:00:00.000Z");
    expect(lagosMidnight(NOW).toISOString()).toBe("2026-11-24T23:00:00.000Z");
  });

  it("has one bucket per day, back to back, ending now", () => {
    const b = buckets("7d", NOW);
    expect(b).toHaveLength(7);
    for (let i = 1; i < b.length; i++) expect(b[i].start.getTime()).toBe(b[i - 1].end.getTime());
    expect(b[6].end).toEqual(NOW);
    expect(b[0].start.toISOString()).toBe("2026-11-18T23:00:00.000Z");
  });

  it("uses weeks for a year", () => {
    const b = buckets("1y", NOW);
    expect(b).toHaveLength(53);
    expect(b[1].start.getTime() - b[0].start.getTime()).toBe(7 * 86_400_000);
    expect(b[b.length - 1].end).toEqual(NOW);
  });

  it("finds the bucket a moment falls in, and nothing outside", () => {
    const b = buckets("7d", NOW);
    expect(bucketIndex(b, new Date("2026-11-25T08:00:00Z"))).toBe(6);
    expect(bucketIndex(b, new Date("2026-11-19T00:00:00Z"))).toBe(0);
    expect(bucketIndex(b, new Date("2026-11-18T22:59:59Z"))).toBe(-1);
    expect(bucketIndex(b, new Date("2026-11-26T00:00:00Z"))).toBe(-1);
  });
});

describe("overview maths", () => {
  it("only gives a change when there is something to compare with", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(10, 0)).toBeNull();
  });

  it("works out the success rate from finished trades only", () => {
    expect(successRate(9, 1)).toBe(90);
    expect(successRate(0, 0)).toBeNull();
  });

  it("formats money and percentages compactly", () => {
    expect(compactNgn(18_700_000_000)).toBe("₦18.7B");
    expect(compactNgn(724_800_000)).toBe("₦724.8M");
    expect(compactNgn(250_000)).toBe("₦250K");
    expect(compactNgn(950)).toBe("₦950");
    expect(formatPct(12.46)).toBe("12.5%");
    expect(formatPct(-0.01)).toBe("0%");
  });
});
