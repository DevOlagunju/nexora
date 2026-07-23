import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { fetchLiveMarkets } from "@/lib/markets-live";
import { UsdtNgnLiveCard } from "@/components/usdt-ngn-live";
import { QuickPayout } from "@/components/quick-payout";
import { RateSellLists } from "@/components/rate-sell-lists";
import { MarketTicker } from "@/components/market-ticker";
import { Reveal } from "@/components/reveal";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export default async function HomePage() {
  const user = await getSessionUser();

  const [rates, ngnPayload, liveMarkets] = await loadHomeData();

  const cryptoRates = rates.filter((r) => r.kind === "CRYPTO");
  const giftRates = rates.filter((r) => r.kind === "GIFTCARD");
  const usdtSell =
    cryptoRates.find((r) => r.symbol === "USDT")?.sellRateNgn ??
    ngnPayload?.desk.USDT.sell ??
    0;
  const appleSell = giftRates.find((r) => r.symbol === "APPLE")?.sellRateNgn ?? 0;

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
      <main>
        <section className="hero-grid relative overflow-hidden text-white">
          <div className="hero-orb hero-orb--a" aria-hidden />
          <div className="hero-orb hero-orb--b" aria-hidden />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-20 pt-16 md:grid-cols-[1.15fr_0.85fr] md:items-end md:pt-24">
            <div>
              <p className="animate-rise font-[family-name:var(--font-display)] text-5xl font-bold tracking-tight md:text-7xl">
                Nexora
              </p>
              <h1 className="animate-rise stagger-1 mt-4 max-w-xl text-2xl font-semibold text-white/90 md:text-3xl">
                Crypto and gift cards to Naira - verified, fast, Nigeria-first.
              </h1>
              <p className="animate-rise stagger-2 mt-4 max-w-lg text-base text-white/65">
                Live rates. Encrypted card codes. Bank payouts after confirmation.
              </p>
              <div className="animate-rise stagger-3 mt-8 flex flex-wrap gap-3">
                <Link href={user ? "/dashboard" : "/register"} className="btn btn-primary">
                  {user ? "Open dashboard" : "Create free account"}
                </Link>
                <Link href="/rates" className="btn glass text-white">
                  Check rates
                </Link>
              </div>
            </div>
            <div className="animate-float relative hidden md:block">
              <div className="glass hero-rate-card rounded-[2rem] p-6">
                <p className="text-sm uppercase tracking-[0.2em] text-accent">Today&apos;s sell</p>
                <p className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight tabular-nums">
                  {formatNgn(usdtSell)}
                </p>
                <p className="mt-1 text-sm uppercase tracking-[0.12em] text-white/55">USDT sell rate</p>
                <ul className="mt-6 space-y-3 text-sm text-white/80">
                  <li className="flex justify-between border-b border-white/10 pb-2">
                    <span>Apple GC</span>
                    <span className="text-gold tabular-nums">{formatNgn(appleSell)}/$</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Payout</span>
                    <span>NGN bank transfer</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <svg
            className="wave-divider relative -mb-px"
            viewBox="0 0 1440 56"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path
              fill="currentColor"
              d="M0,32 C240,56 480,0 720,16 C960,32 1200,56 1440,24 L1440,56 L0,56 Z"
            />
          </svg>
        </section>

        <MarketTicker initial={liveMarkets} />

        <section id="rates" className="mx-auto max-w-6xl px-4 py-16">
          <Reveal>
            <p className="section-label">Rates</p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">
              What you get today
            </h2>
            <p className="mt-2 max-w-2xl text-ink-soft">
              Your order locks at the rate shown when you trade. Full market table and calculator live
              on{" "}
              <Link href="/rates" className="font-semibold text-accent-deep underline">
                Rates
              </Link>
              .
            </p>
          </Reveal>

          <Reveal className="mt-8" delay={60}>
            <UsdtNgnLiveCard initial={ngnPayload} />
          </Reveal>

          <div className="mt-10 grid items-start gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <Reveal delay={80}>
              <RateSellLists cryptoRates={cryptoRates} giftRates={giftRates} />
            </Reveal>
            <Reveal delay={120}>
              <QuickPayout options={estimateOptions} ctaHref={user ? "/dashboard" : "/register"} />
            </Reveal>
          </div>
        </section>

        <section id="how" className="border-y border-[var(--line)] bg-paper-deep/70 py-16">
          <div className="mx-auto max-w-6xl px-4">
            <Reveal>
              <p className="section-label">How it works</p>
              <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">
                Verify once. Trade. Get paid.
              </h2>
              <p className="mt-2 max-w-xl text-ink-soft">
                Accounts and tracking are automated. Value movement is desk-confirmed.
              </p>
            </Reveal>
            <ol className="flow-row mt-10">
              {[
                {
                  n: "01",
                  t: "Verify once",
                  d: "Register, then submit BVN/NIN last-4 + bank for KYC.",
                },
                {
                  n: "02",
                  t: "Create an order",
                  d: "Sell crypto or a gift card, or buy crypto with Naira.",
                },
                {
                  n: "03",
                  t: "Get paid in Naira",
                  d: "Desk confirms, payouts land in your bank - track in Orders.",
                },
              ].map((step, i) => (
                <li
                  key={step.n}
                  className="flow-item list-none animate-rise"
                  style={{ animationDelay: `${0.08 + i * 0.1}s` }}
                >
                  <p className="n">{step.n}</p>
                  <h3 className="mt-2 text-lg font-semibold text-ink">{step.t}</h3>
                  <p className="mt-2 text-sm text-ink-soft">{step.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-6xl px-4 py-16">
          <Reveal>
            <p className="section-label">FAQ</p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold">
              Straight answers
            </h2>
          </Reveal>
          <div className="mt-8 space-y-0 divide-y divide-[var(--line)] border-t border-[var(--line)]">
            {[
              {
                q: "Is this a full automated exchange?",
                a: "Nexora is hybrid: accounts, rates, and order tracking are automated; deposits and gift cards are desk-verified before Naira payout.",
              },
              {
                q: "Which assets can I sell?",
                a: "USDT, BTC, ETH, plus Apple, Steam, Amazon, and Google Play gift cards - with admin-managed rates.",
              },
              {
                q: "How do you protect gift card codes?",
                a: "Codes are encrypted with AES-256-GCM before storage. Only authorized admin workflows decrypt during verification.",
              },
            ].map((item) => (
              <details key={item.q} className="faq-item group py-4">
                <summary className="faq-summary cursor-pointer list-none font-semibold text-ink marker:content-none">
                  <span>{item.q}</span>
                  <span className="faq-plus" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="faq-answer mt-2 max-w-2xl text-sm text-ink-soft">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20">
          <Reveal>
            <div className="cta-panel overflow-hidden rounded-[2rem] bg-ink px-6 py-10 text-white md:px-10">
              <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold">
                Ready to trade with confidence?
              </h2>
              <p className="mt-2 max-w-lg text-white/70">
                Same secure backend on web and mobile. Start with KYC, then sell or buy.
              </p>
              <Link
                href={user ? "/dashboard" : "/register"}
                className="btn btn-primary mt-6 inline-flex"
              >
                {user ? "Go to dashboard" : "Get started"}
              </Link>
            </div>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

async function loadHomeData() {
  const ratesPromise = prisma.rate.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const marketsPromise = fetchLiveMarkets(16).catch(() => []);

  const rates = await ratesPromise;
  const liveMarkets = await marketsPromise;

  let ngnPayload: {
    market: { usdtNgn: number; btcNgn: number; ethNgn: number; fetchedAt: string };
    desk: {
      USDT: { mid: number; sell: number; buy: number };
      BTC: { mid: number; sell: number; buy: number };
      ETH: { mid: number; sell: number; buy: number };
    };
  } | null = null;

  try {
    const { fetchRateBenchmark, deskQuotesFromBenchmark } = await import("@/lib/rate-benchmark");
    const benchmark = await fetchRateBenchmark();
    const desk = deskQuotesFromBenchmark(benchmark);
    ngnPayload = {
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
    ngnPayload = null;
  }

  return [rates, ngnPayload, liveMarkets] as const;
}
