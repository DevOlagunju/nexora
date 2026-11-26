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
import { GetTheAppSection, StoreBadges } from "@/components/get-the-app";
import { HeroPhone } from "@/components/landing/hero-phone";
import { HeroSweep, Skyline } from "@/components/landing/skyline";
import {
  ArrowRightIcon,
  BankIcon,
  CheckCircleIcon,
  BoltIcon,
  GiftIcon,
  HeadsetIcon,
  LockIcon,
  RocketIcon,
  ShieldCheckIcon,
  ShieldSolidIcon,
  TagIcon,
  WhatsAppIcon,
} from "@/components/landing/icons";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { getDeskSpeed } from "@/lib/desk-stats";
import { formatDuration } from "@/lib/alert-rules";
import { walletConfig } from "@/lib/wallet-rules";
import { supportWhatsAppUrl } from "@/lib/support";
import { loadDeskPayload } from "@/lib/desk-rates";

export default async function HomePage() {
  const user = await getSessionUser();

  const [[rates, ngnPayload, liveMarkets], speed] = await Promise.all([loadHomeData(), getDeskSpeed(7)]);
  const cfg = walletConfig();
  const whatsapp = supportWhatsAppUrl("Hi Nexora, I want to trade.");
  const fastest = [speed.giftMedianMin, speed.cryptoMedianMin].filter((m): m is number => m !== null);
  const speedLine = fastest.length ? `Median payout last 7 days: ${formatDuration(Math.min(...fastest))}` : null;

  const cryptoRates = rates.filter((r) => r.kind === "CRYPTO");
  const giftRates = rates.filter((r) => r.kind === "GIFTCARD");

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

  const usdtRate = cryptoRates.find((r) => r.symbol === "USDT")?.sellRateNgn ?? 0;


  const strip = [
    { Icon: ShieldCheckIcon, label: "Secure by Design" },
    { Icon: BoltIcon, label: "Fast Naira Payouts" },
    { Icon: HeadsetIcon, label: whatsapp ? "WhatsApp Support" : "Real People Support" },
    { Icon: BankIcon, label: "Any Nigerian Bank" },
    { Icon: GiftIcon, label: "Earn Rewards" },
  ];

  const why = [
    { Icon: RocketIcon, title: "Fast & Easy", text: "Sign up in the app in minutes and trade straight from your phone." },
    {
      Icon: TagIcon,
      title: "Low Fees",
      text: `No trading fee: the rate you see is what you get. ${formatNgn(cfg.withdrawalFeeNgn)} to withdraw.`,
    },
    {
      Icon: ShieldCheckIcon,
      title: "Secure & Trusted",
      text: "Gift card codes are encrypted and every withdrawal needs your PIN.",
    },
    { Icon: LockIcon, title: "Rate Locked", text: "Your Naira amount is fixed the moment you place an order." },
  ];

  return (
    <>
      <SiteHeader user={user} current="home" />
      <main>
        <section className="landing-hero relative -mt-[4.75rem] overflow-hidden pt-[4.75rem]">
          <HeroSweep className="pointer-events-none absolute right-0 top-0 hidden h-[92%] w-[58%] opacity-90 lg:block" />
          <Skyline className="pointer-events-none absolute bottom-0 right-0 hidden h-[60%] w-[62%] opacity-80 [mask-image:linear-gradient(to_right,transparent,black_18%)] lg:block" />

          <div className="site-wrap relative grid gap-10 pb-28 pt-10 lg:min-h-[41rem] lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:pb-24 lg:pt-8">
            <div className="relative z-10">
              <p className="animate-rise inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-1.5 text-[15px] font-semibold text-accent-deep">
                <ShieldSolidIcon className="h-[18px] w-[18px] text-accent" />
                Crypto &amp; gift cards, paid in Naira
              </p>
              <h1 className="animate-rise stagger-1 mt-6 font-[family-name:var(--font-display)] text-[2.9rem] font-bold leading-[1.04] tracking-[-0.03em] text-ink sm:text-6xl xl:text-[4.6rem]">
                Trade, Sell &amp; Get Paid with <span className="text-accent">Nexora</span>
              </h1>
              <p className="animate-rise stagger-2 mt-6 max-w-xl text-lg leading-relaxed text-ink md:text-[1.35rem]">
                Buy and sell crypto and gift cards for Naira with ease. Fast. Secure. Reliable.
              </p>
              <div className="animate-rise stagger-3 mt-8">
                <StoreBadges size="lg" />
              </div>
              {usdtRate ? (
                <Link href="/rates" className="hero-live animate-rise stagger-3 mt-7">
                  <span className="hero-live-dot" aria-hidden="true" />
                  <span>
                    Live: we pay <strong className="tabular-nums text-ink">{formatNgn(usdtRate)}</strong> per USDT
                  </span>
                  <span className="font-semibold text-accent-deep">All rates →</span>
                </Link>
              ) : (
                <Link href="/rates" className="mt-7 inline-block font-semibold text-accent-deep hover:underline">
                  See today&apos;s rates →
                </Link>
              )}
              <ul className="animate-rise stagger-3 mt-6 flex max-w-2xl flex-wrap gap-x-6 gap-y-2.5">
                {[
                  "Rate locked when you order",
                  "Auto refund if a payout fails",
                  speedLine ?? "PIN-protected withdrawals",
                ].map((t) => (
                  <li key={t} className="flex items-center gap-2 text-[15px] font-medium text-ink-soft">
                    <CheckCircleIcon className="h-5 w-5 shrink-0 text-accent" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative hidden h-[38rem] lg:block">
              <p className="hero-script absolute -right-6 top-28 z-20 text-right">
                Your
                <br />
                Financial Freedom
                <br />
                Our <span className="swoosh-underline swoosh-underline--lg">Priority</span>
              </p>
              <div className="absolute left-[2%] top-2 z-10">
                <HeroPhone />
              </div>
            </div>
          </div>
        </section>

        <div className="site-wrap relative z-10 -mt-16">
          <ul className="feature-strip">
            {strip.map(({ Icon, label }) => (
              <li key={label} className="flex items-center justify-center gap-3.5 px-4 py-5">
                <Icon className="h-8 w-8 shrink-0 text-accent" />
                <span className="max-w-[7.5rem] text-[15px] leading-snug text-ink-soft">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <section id="about" className="site-wrap grid scroll-mt-24 items-center gap-8 py-16 lg:grid-cols-[0.8fr_1.9fr]">
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3.5 py-1 text-sm font-semibold text-accent-deep">
              <ShieldSolidIcon className="h-4 w-4 text-accent" /> Why Choose Nexora?
            </p>
            <h2 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-bold leading-tight text-ink md:text-[2.4rem]">
              A Smarter Way to Sell Your Digital Assets
            </h2>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-ink-soft">
              From crypto to gift cards, Nexora gives you clear rates, fast Naira payouts and complete peace of mind.
            </p>
            <Link href="/#rates" className="outline-pill mt-6">
              Explore Features <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {why.map(({ Icon, title, text }, i) => (
              <Reveal key={title} delay={i * 60}>
                <div className="why-card">
                  <span className="why-card-icon">
                    <Icon className="h-8 w-8" />
                  </span>
                  <h3 className="mt-5 text-xl font-bold text-ink">{title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <MarketTicker initial={liveMarkets} />

        <section id="rates" className="site-wrap scroll-mt-24 py-16">
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
            <Reveal delay={120} className="lg:sticky lg:top-24">
              <QuickPayout options={estimateOptions} ctaHref="/#get-app" ctaLabel="Trade this rate in the app" />
            </Reveal>
          </div>
        </section>

        <section id="how" className="border-y border-[var(--line)] bg-paper-deep/60 py-16">
          <div className="site-wrap grid items-center gap-8 lg:grid-cols-[0.8fr_1.9fr]">
            <Reveal>
              <p className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1 text-sm font-semibold text-accent-deep">
                <ShieldSolidIcon className="h-4 w-4 text-accent" /> How it works
              </p>
              <h2 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-bold leading-tight text-ink md:text-[2.4rem]">
                Verify once. Trade. Get paid.
              </h2>
              <p className="mt-4 max-w-md text-[17px] leading-relaxed text-ink-soft">
                Accounts and tracking are automated. Every payout is checked by the desk before Naira moves.
              </p>
            </Reveal>
            <div className="grid gap-4 md:grid-cols-3">
              {[
                {
                  Icon: ShieldCheckIcon,
                  t: "Verify once",
                  d: "Get the Nexora app, sign up in a minute and add your BVN, NIN and bank account. The desk reviews it.",
                },
                {
                  Icon: TagIcon,
                  t: "Create an order",
                  d: "Sell crypto or a gift card, or buy crypto with Naira. Your rate is locked the moment you order.",
                },
                {
                  Icon: BankIcon,
                  t: "Get paid in Naira",
                  d: "The desk confirms and Naira lands in your wallet or bank. Track every step live in the app.",
                },
              ].map(({ Icon, t, d }, i) => (
                <Reveal key={t} delay={i * 80}>
                  <div className="step-card">
                    <div className="flex items-center justify-between">
                      <span className="why-card-icon h-14 w-14 rounded-2xl">
                        <Icon className="h-7 w-7" />
                      </span>
                      <span className="font-[family-name:var(--font-display)] text-4xl font-bold text-accent/20">
                        0{i + 1}
                      </span>
                    </div>
                    <h3 className="mt-5 text-xl font-bold text-ink">{t}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{d}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="site-wrap grid scroll-mt-24 gap-10 py-16 lg:grid-cols-[0.8fr_1.9fr]">
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3.5 py-1 text-sm font-semibold text-accent-deep">
              <ShieldSolidIcon className="h-4 w-4 text-accent" /> FAQ
            </p>
            <h2 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-bold leading-tight text-ink md:text-[2.4rem]">
              Straight answers
            </h2>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-ink-soft">
              Fees, payout times and how we keep your money and details safe.
            </p>
            {whatsapp ? (
              <div className="mt-6 max-w-sm rounded-3xl border border-[var(--line)] bg-white p-5 shadow-[0_10px_30px_rgba(10,79,42,0.06)]">
                <p className="font-bold text-ink">Still have a question?</p>
                <p className="mt-1 text-sm text-ink-soft">Message a real person on our support line.</p>
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="outline-pill mt-4">
                  <WhatsAppIcon className="h-[18px] w-[18px]" /> Chat on WhatsApp
                </a>
              </div>
            ) : null}
          </Reveal>
          <Reveal delay={80}>
            <div className="faq-card divide-y divide-[var(--line)]">
              {[
                {
                  q: "Is this a fully automated exchange?",
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
                <details key={item.q} className="faq-item group px-6 py-4">
                  <summary className="faq-summary cursor-pointer list-none font-semibold text-ink marker:content-none">
                    <span>{item.q}</span>
                    <span className="faq-plus" aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className="faq-answer mt-2 max-w-3xl text-[15px] text-ink-soft">{item.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </section>

        <Reveal>
          <GetTheAppSection whatsapp={whatsapp} />
        </Reveal>
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

  // Market mid next to the real desk rates (never a rate derived from the market).
  const ngnPayload = (await loadDeskPayload().catch(() => null))?.payload ?? null;

  return [rates, ngnPayload, liveMarkets] as const;
}
