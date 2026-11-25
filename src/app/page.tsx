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
import { getDeskSpeed } from "@/lib/desk-stats";
import { formatDuration } from "@/lib/alert-rules";
import { walletConfig } from "@/lib/wallet-rules";
import { supportWhatsAppUrl } from "@/lib/support";

export default async function HomePage() {
  const user = await getSessionUser();

  const [[rates, ngnPayload, liveMarkets], speed] = await Promise.all([loadHomeData(), getDeskSpeed(7)]);
  const cfg = walletConfig();
  const whatsapp = supportWhatsAppUrl("Hi Nexora, I want to trade.");
  const fastest = [speed.giftMedianMin, speed.cryptoMedianMin].filter((m): m is number => m !== null);
  const speedLine = fastest.length ? `Median payout last 7 days: ${formatDuration(Math.min(...fastest))}` : null;

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
                Sell crypto and gift cards. Get Naira you can actually count on.
              </h1>
              <p className="animate-rise stagger-2 mt-4 max-w-lg text-base text-white/65">
                Your rate is locked the moment you place an order. Naira lands in your wallet as soon as the desk
                confirms. Withdraw to any Nigerian bank with your PIN.
              </p>
              <div className="animate-rise stagger-3 mt-8 flex flex-wrap gap-3">
                <Link href={user ? "/dashboard" : "/register"} className="btn btn-primary">
                  {user ? "Open dashboard" : "Create free account"}
                </Link>
                <Link href="/rates" className="btn glass text-white">
                  Check today&apos;s rates
                </Link>
              </div>
              <ul className="animate-rise stagger-3 mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/70">
                <li>✓ Rate locked at order</li>
                <li>✓ Auto refund if a payout fails</li>
                {speedLine ? <li>✓ {speedLine}</li> : <li>✓ WhatsApp support</li>}
              </ul>
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
                    <span>Wallet or any NG bank</span>
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

        <section className="mx-auto max-w-6xl px-4 pt-16" aria-labelledby="why-title">
          <Reveal>
            <p className="section-label">Why traders switch</p>
            <h2 id="why-title" className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">
              Built around what goes wrong elsewhere
            </h2>
            <p className="mt-2 max-w-2xl text-ink-soft">
              Rates that change after you send. Payouts stuck with no update. Support that disappears. We designed
              Nexora so none of that is your problem.
            </p>
          </Reveal>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                t: "Your rate is locked",
                d: "The Naira amount you see when you place the order is what you get. No re-rating after you send.",
              },
              {
                t: "Naira wallet, instant credit",
                d: "Approved trades land in your wallet immediately. Withdraw to your bank any time, protected by a 4-digit PIN.",
              },
              {
                t: "Failed payout? Auto refund",
                d: "If a withdrawal to your bank bounces, the full amount and fee go straight back to your wallet. No chasing support.",
              },
              {
                t: "Rate alerts",
                d: "Tell us your target rate for USDT, BTC or gift cards. We notify you the moment the desk hits it.",
              },
              {
                t: "Speed you can check",
                d: speedLine
                  ? `${speedLine}, from real completed trades. Published, not promised.`
                  : "We publish our real median payout time from completed trades. Published, not promised.",
              },
              {
                t: `Earn ${formatNgn(cfg.referralBonusNgn)} per friend`,
                d: "Share your code. When a friend completes their first trades, the bonus drops in your wallet.",
              },
            ].map((f) => (
              <li key={f.t} className="card-panel list-none">
                <p className="font-semibold text-ink">{f.t}</p>
                <p className="mt-1.5 text-sm text-ink-soft">{f.d}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className="mt-16 border-y border-[var(--line)] bg-paper-deep/70 py-16">
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
                  d: "Sign up in a minute, add your BVN, NIN and bank account. Then the desk reviews it.",
                },
                {
                  n: "02",
                  t: "Create an order",
                  d: "Sell crypto or a gift card, or buy crypto with Naira.",
                },
                {
                  n: "03",
                  t: "Get paid in Naira",
                  d: "Desk confirms, Naira lands in your wallet or bank. Track every step live.",
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
                q: "How fast do I get paid?",
                a: speedLine
                  ? `${speedLine}. Wallet payouts are credited the moment the desk approves your trade; withdrawals go out to your bank after that.`
                  : "Wallet payouts are credited the moment the desk approves your trade. Withdrawals go to your bank after that.",
              },
              {
                q: "What fees do you charge?",
                a: `Our rate already includes our margin, so there is no trading fee. Withdrawals to your bank cost ${formatNgn(cfg.withdrawalFeeNgn)}, shown before you confirm.`,
              },
              {
                q: "What happens if my payout fails?",
                a: "If a withdrawal to your bank fails or is reversed, the full amount (including the fee) is returned to your Nexora wallet automatically and you get a notification. Direct-to-bank trade payouts that fail are retried by the desk.",
              },
              {
                q: "Which assets can I sell?",
                a: "USDT, BTC, ETH, plus Apple, Steam, Amazon, and Google Play gift cards - with admin-managed rates.",
              },
              {
                q: "How do you protect gift card codes?",
                a: "Codes are encrypted with AES-256-GCM before storage. Only authorized admin workflows decrypt during verification.",
              },
              {
                q: "Is my BVN safe?",
                a: "We only keep the last 4 digits of your BVN and NIN. Withdrawals only ever go to the bank account you verified, and every withdrawal needs your PIN.",
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
                Verify once, then sell or buy in minutes on web or the mobile app.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href={user ? "/dashboard" : "/register"} className="btn btn-primary inline-flex">
                  {user ? "Go to dashboard" : "Create free account"}
                </Link>
                {whatsapp && (
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="btn glass inline-flex text-white">
                    Chat on WhatsApp
                  </a>
                )}
              </div>
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
