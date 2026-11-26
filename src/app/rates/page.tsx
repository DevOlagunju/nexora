import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fetchLiveMarkets } from "@/lib/markets-live";
import { loadDeskPayload } from "@/lib/desk-rates";
import { QuickPayout } from "@/components/quick-payout";
import { RateSellLists } from "@/components/rate-sell-lists";
import { LiveMarketsTable } from "@/components/live-markets-table";
import { UsdtNgnLiveCard } from "@/components/usdt-ngn-live";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { formatClockTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RatesPage() {
  const user = await getSessionUser();

  const [stored, liveMarkets] = await Promise.all([
    prisma.rate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
    fetchLiveMarkets(30).catch(() => []),
  ]);

  // Market mid next to the real desk rates (never a rate derived from the market).
  const loaded = await loadDeskPayload().catch(() => null);
  const ngnPayload = loaded?.payload ?? null;
  const fetchedAt: string | null = ngnPayload?.market.fetchedAt ?? null;
  const source = loaded?.live ? "live" : "desk";

  const cryptoRates = stored.filter((r) => r.kind === "CRYPTO");
  const giftRates = stored.filter((r) => r.kind === "GIFTCARD");

  const estimateOptions = [
    ...cryptoRates.map((r) => ({
      symbol: r.symbol,
      displayName: r.displayName,
      sellRateNgn: r.sellRateNgn,
      kind: "CRYPTO" as const,
    })),
    ...giftRates.map((r) => ({
      symbol: r.symbol,
      displayName: r.displayName,
      sellRateNgn: r.sellRateNgn,
      kind: "GIFTCARD" as const,
    })),
  ];

  return (
    <>
      <SiteHeader user={user} />
      <main className="page-shell max-w-6xl">
        <p className="section-label">Rates</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-bold text-ink">
          Know your payout before you trade
        </h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Desk rates lock into your order
          {fetchedAt ? ` · ${formatClockTime(fetchedAt)}` : ""}
          {source === "desk" ? " · from Nexora rates" : " · live reference"}.
        </p>

        <div className="mt-8">
          <UsdtNgnLiveCard initial={ngnPayload} />
        </div>

        <div className="mt-10 grid items-start gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <RateSellLists cryptoRates={cryptoRates} giftRates={giftRates} showBuy />
          <QuickPayout options={estimateOptions} ctaHref="/#get-app" ctaLabel="Trade this rate in the app" />
        </div>

        <section className="mt-14">
          <p className="section-label">Live market</p>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold">
            Global crypto snapshot
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            Reference market data only - your trade uses the rates above.
          </p>
          <div className="mt-6">
            {liveMarkets.length > 0 ? (
              <LiveMarketsTable initial={liveMarkets} />
            ) : (
              <div className="panel text-sm text-ink-soft">
                Live market feed is temporarily unavailable. Trade rates above are still active.
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
