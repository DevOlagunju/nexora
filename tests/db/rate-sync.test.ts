import { beforeAll, describe, expect, it, vi } from "vitest";

// The live market feeds are replaced; everything else (spreads, rounding, database) is real.
const feed = vi.hoisted(() => ({ fetchReliableDeskBenchmark: vi.fn() }));
vi.mock("@/lib/rate-benchmark", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rate-benchmark")>();
  return { ...real, fetchReliableDeskBenchmark: feed.fetchReliableDeskBenchmark };
});

import { prisma } from "@/lib/db";
import { syncDeskRatesFromMarket, updateRate } from "@/lib/services/desk";
import { makeAdmin } from "../helpers/fixtures";

const rate = (symbol: string) => prisma.rate.findUniqueOrThrow({ where: { kind_symbol: { kind: "CRYPTO", symbol } } });

beforeAll(async () => {
  await prisma.rate.createMany({
    data: [
      { kind: "CRYPTO", symbol: "USDT", displayName: "Tether", sellRateNgn: 1400, buyRateNgn: 1420, sellSpreadPct: 1, buySpreadPct: 1 },
      { kind: "CRYPTO", symbol: "BTC", displayName: "Bitcoin", sellRateNgn: 140_000_000, buyRateNgn: 142_000_000, sellSpreadPct: 0.5, buySpreadPct: 2 },
      { kind: "CRYPTO", symbol: "ETH", displayName: "Ether", sellRateNgn: 4_000_000, buyRateNgn: 4_100_000, isActive: false },
    ],
  });
});

describe("market sync", () => {
  it("sets each asset's rates from the market mid and its own spread, and records the mid", async () => {
    feed.fetchReliableDeskBenchmark.mockResolvedValueOnce({ referenceMid: 1_500, btcUsd: 100_000, ethUsd: 3_000, fetchedAt: "", source: "test" });
    const res = await syncDeskRatesFromMarket();
    expect(res.ok).toBe(true);

    expect(await rate("USDT")).toMatchObject({ sellRateNgn: 1_485, buyRateNgn: 1_515, marketRateNgn: 1_500 });
    expect(await rate("BTC")).toMatchObject({ sellRateNgn: 149_250_000, buyRateNgn: 153_000_000, marketRateNgn: 150_000_000 });
    expect((await rate("USDT")).marketRateAt).toBeInstanceOf(Date);
  });

  it("never sells at the market price unless the desk sets a zero spread (the old hardcoded behaviour)", async () => {
    const usdt = await rate("USDT");
    expect(usdt.sellRateNgn).toBeLessThan(usdt.marketRateNgn!);
    expect(usdt.buyRateNgn).toBeGreaterThan(usdt.marketRateNgn!);
  });

  it("does not switch on an asset the desk switched off", async () => {
    expect((await rate("ETH")).isActive).toBe(false);
  });

  it("uses a spread the desk changes on the next sync", async () => {
    const admin = await makeAdmin();
    const usdt = await rate("USDT");
    expect(
      (await updateRate(admin, { id: usdt.id, sellRateNgn: usdt.sellRateNgn, buyRateNgn: usdt.buyRateNgn, sellSpreadPct: "2", buySpreadPct: "0.5", isActive: true })).ok,
    ).toBe(true);

    feed.fetchReliableDeskBenchmark.mockResolvedValueOnce({ referenceMid: 1_600, btcUsd: 100_000, ethUsd: 3_000, fetchedAt: "", source: "test" });
    await syncDeskRatesFromMarket();
    expect(await rate("USDT")).toMatchObject({ sellRateNgn: 1_568, buyRateNgn: 1_608, sellSpreadPct: 2, buySpreadPct: 0.5 });
  });

  it("keeps the saved rates when the feeds are down", async () => {
    const before = await rate("USDT");
    feed.fetchReliableDeskBenchmark.mockRejectedValueOnce(new Error("CoinGecko busy (429)"));
    const res = await syncDeskRatesFromMarket();
    expect(res).toMatchObject({ ok: false, status: 502 });
    expect(await rate("USDT")).toMatchObject({ sellRateNgn: before.sellRateNgn, buyRateNgn: before.buyRateNgn });
  });
});

describe("desk rate edits", () => {
  it("refuses a sell rate above the buy rate, and a spread that looks like a typo", async () => {
    const admin = await makeAdmin();
    const usdt = await rate("USDT");
    expect(await updateRate(admin, { id: usdt.id, sellRateNgn: 1_600, buyRateNgn: 1_500, isActive: true })).toMatchObject({ ok: false, status: 422 });
    expect(await updateRate(admin, { id: usdt.id, sellRateNgn: 1_500, buyRateNgn: 1_520, sellSpreadPct: "35", isActive: true })).toMatchObject({ ok: false });
    expect(await updateRate(admin, { id: usdt.id, sellRateNgn: 1_500, buyRateNgn: 1_520, buySpreadPct: "-1", isActive: true })).toMatchObject({ ok: false });
  });

  it("records the old and new spread in the audit log", async () => {
    const admin = await makeAdmin();
    const btc = await rate("BTC");
    await updateRate(admin, { id: btc.id, sellRateNgn: btc.sellRateNgn, buyRateNgn: btc.buyRateNgn, sellSpreadPct: "0.75", isActive: true });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { userId: admin.id, action: "admin.rate_update" } });
    const meta = JSON.parse(audit.meta ?? "{}") as { from: { sellSpreadPct: number }; to: { sellSpreadPct: number } };
    expect([meta.from.sellSpreadPct, meta.to.sellSpreadPct]).toEqual([0.5, 0.75]);
  });
});
