import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fetchLiveMarkets } from "@/lib/markets";
import { formatNgn } from "@/lib/format";
import { LiveMarketsTable } from "@/components/live-markets-table";
import { UsdtNgnLiveCard } from "@/components/usdt-ngn-live";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export default async function HomePage() {
  const user = await getSessionUser();

  const [rates, liveMarkets, ngnPayload] = await Promise.all([
    prisma.rate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    }),
    fetchLiveMarkets(30).catch(() => []),
    (async () => {
      try {
        const { fetchRateBenchmark, deskQuotesFromBenchmark } = await import("@/lib/rate-benchmark");
        const benchmark = await fetchRateBenchmark();
        const desk = deskQuotesFromBenchmark(benchmark);
        await Promise.all(
          (["USDT", "BTC", "ETH"] as const).map((symbol) =>
            prisma.rate.updateMany({
              where: { kind: "CRYPTO", symbol },
              data: {
                sellRateNgn: desk[symbol].sell,
                buyRateNgn: desk[symbol].buy,
              },
            }),
          ),
        );
        return {
          market: {
            usdtNgn: benchmark.referenceMid,
            btcNgn: desk.BTC.mid,
            ethNgn: desk.ETH.mid,
            fetchedAt: benchmark.fetchedAt,
          },
          desk: {
            USDT: desk.USDT,
            BTC: desk.BTC,
            ETH: desk.ETH,
          },
        };
      } catch {
        return null;
      }
    })(),
  ]);

  const refreshedRates = ngnPayload
    ? await prisma.rate.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
      })
    : rates;

  const cryptoRates = refreshedRates.filter((r) => r.kind === "CRYPTO");
  const giftRates = refreshedRates.filter((r) => r.kind === "GIFTCARD");
  const usdtSell = ngnPayload?.desk.USDT.sell ?? cryptoRates.find((r) => r.symbol === "USDT")?.sellRateNgn ?? 0;

  return (
    <>
      <SiteHeader user={user} />
      <main>
        <section className="hero-grid relative overflow-hidden text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-20 pt-16 md:grid-cols-[1.1fr_0.9fr] md:items-end md:pt-24">
            <div>
              <p className="animate-rise font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight md:text-7xl">
                Nexora
              </p>
              <h1 className="animate-rise stagger-1 mt-4 max-w-xl text-2xl font-semibold text-white/90 md:text-3xl">
                Crypto and gift cards to Naira — verified, fast, Nigeria-first.
              </h1>
              <p className="animate-rise stagger-2 mt-4 max-w-lg text-base text-white/65">
                Live desk rates. Encrypted card codes. Bank payouts after confirmation.
              </p>
              <div className="animate-rise stagger-3 mt-8 flex flex-wrap gap-3">
                <Link href={user ? "/dashboard" : "/register"} className="btn btn-primary">
                  {user ? "Open dashboard" : "Create free account"}
                </Link>
                <Link href="/rates" className="btn glass text-white">
                  Rate calculator
                </Link>
              </div>
            </div>
            <div className="animate-float relative hidden md:block">
              <div className="glass rounded-[2rem] p-6">
                <p className="text-sm uppercase tracking-[0.2em] text-accent">Today</p>
                <p className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">
                  Sell · Settle · Done
                </p>
                <ul className="mt-6 space-y-3 text-sm text-white/80">
                  <li className="flex justify-between border-b border-white/10 pb-2">
                    <span>USDT sell</span>
                    <span className="text-accent">{formatNgn(usdtSell)}</span>
                  </li>
                  <li className="flex justify-between border-b border-white/10 pb-2">
                    <span>Apple GC</span>
                    <span className="text-gold">
                      {formatNgn(giftRates.find((r) => r.symbol === "APPLE")?.sellRateNgn ?? 0)}/$
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Payout rail</span>
                    <span>NGN bank transfer</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <svg className="wave-divider relative -mb-px" viewBox="0 0 1440 56" preserveAspectRatio="none" aria-hidden>
            <path fill="currentColor" d="M0,32 C240,56 480,0 720,16 C960,32 1200,56 1440,24 L1440,56 L0,56 Z" />
          </svg>
        </section>

        <div className="bg-ink text-center text-sm text-white">
          <p className="px-4 py-3">Outstanding service · Competitive rates · Fast & secure payout</p>
        </div>

        <section id="live-market" className="mx-auto max-w-7xl px-4 py-16">
          <p className="badge">Live crypto market</p>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">
            Live crypto market rates
          </h2>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Real-time global market data — market cap, price, supply, volume, and 24h change. Auto-refreshes
            every 45 seconds.
          </p>
          <div className="mt-8">
            {liveMarkets.length > 0 ? (
              <LiveMarketsTable initial={liveMarkets} />
            ) : (
              <div className="card-panel text-sm text-ink-soft">
                Live market feed is temporarily unavailable. Desk sell rates below are still active.
              </div>
            )}
          </div>
        </section>

        <section id="rates" className="mx-auto max-w-6xl px-4 pb-16">
          <p className="badge">Live desk rates</p>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">
            1 USDT → Naira
          </h2>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Live rates for crypto sells. Use the{" "}
            <Link href="/rates" className="font-semibold text-accent-deep underline">
              calculator
            </Link>{" "}
            to see your payout before you trade.
          </p>

          <div className="mt-8">
            <UsdtNgnLiveCard initial={ngnPayload} />
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="card-panel">
              <h3 className="font-semibold text-ink">Crypto sell rates (desk)</h3>
              <ul className="mt-4 divide-y divide-[var(--line)]">
                {cryptoRates.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-3 text-sm">
                    <span>
                      {r.displayName}
                      <span className="block text-xs text-ink-soft">Sell rate</span>
                    </span>
                    <span className="font-semibold text-accent-deep">{formatNgn(r.sellRateNgn)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card-panel">
              <h3 className="font-semibold text-ink">Gift cards (per $1)</h3>
              <ul className="mt-4 divide-y divide-[var(--line)]">
                {giftRates.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-3 text-sm">
                    <span>
                      {r.displayName}
                      <span className="block text-xs text-ink-soft">Sell rate</span>
                    </span>
                    <span className="font-semibold text-accent-deep">{formatNgn(r.sellRateNgn)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="how" className="bg-paper-deep py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold text-ink">
              How Nexora works
            </h2>
            <p className="mt-2 max-w-xl text-ink-soft">
              Hybrid operations: automated account flows, human verification on value movement.
            </p>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                {
                  n: "01",
                  t: "Verify once",
                  d: "Register with Nigeria phone details, submit BVN/NIN last-4 + bank account for KYC.",
                },
                {
                  n: "02",
                  t: "Create a sell order",
                  d: "Crypto: send to our wallet and paste TX hash. Gift cards: submit code (encrypted at rest).",
                },
                {
                  n: "03",
                  t: "Get paid in Naira",
                  d: "Desk confirms receipt, marks payout, and you track status from your dashboard.",
                },
              ].map((step) => (
                <li key={step.n} className="card-panel">
                  <p className="text-sm font-bold text-accent">{step.n}</p>
                  <h3 className="mt-2 text-lg font-semibold">{step.t}</h3>
                  <p className="mt-2 text-sm text-ink-soft">{step.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold">FAQ</h2>
          <div className="mt-6 space-y-3">
            {[
              {
                q: "Is this a full automated exchange?",
                a: "Nexora uses hybrid ops: accounts, rates, and order tracking are automated; crypto deposits and gift cards are desk-verified before Naira payout for fraud control.",
              },
              {
                q: "Which assets can I sell?",
                a: "USDT, BTC, ETH, plus Apple, Steam, Amazon, and Google Play gift cards — with admin-managed rates.",
              },
              {
                q: "How do you protect gift card codes?",
                a: "Codes are encrypted with AES-256-GCM before storage. Only authorized admin workflows can decrypt during verification.",
              },
            ].map((item) => (
              <details key={item.q} className="card-panel group">
                <summary className="cursor-pointer list-none font-semibold marker:content-none">
                  {item.q}
                </summary>
                <p className="mt-2 text-sm text-ink-soft">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20">
          <div className="overflow-hidden rounded-[2rem] bg-ink px-6 py-10 text-white md:px-10">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold">
              Ready to trade with confidence?
            </h2>
            <p className="mt-2 max-w-lg text-white/70">
              Web first. Native app next. Same secure backend.
            </p>
            <Link href={user ? "/dashboard" : "/register"} className="btn btn-primary mt-6 inline-flex">
              {user ? "Go to dashboard" : "Get started"}
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
