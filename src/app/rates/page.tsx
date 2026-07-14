import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fetchRateBenchmark, deskQuotesFromBenchmark } from "@/lib/rate-benchmark";
import { RateCalculator } from "@/components/rate-calculator";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { formatClockTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RatesPage() {
  const user = await getSessionUser();
  let desk = {
    USDT: { mid: 0, sell: 0, buy: 0 },
    BTC: { mid: 0, sell: 0, buy: 0 },
    ETH: { mid: 0, sell: 0, buy: 0 },
  };
  let fetchedAt: string | null = null;

  try {
    const benchmark = await fetchRateBenchmark();
    desk = deskQuotesFromBenchmark(benchmark);
    fetchedAt = benchmark.fetchedAt;
    await Promise.all(
      (["USDT", "BTC", "ETH"] as const).map((symbol) =>
        prisma.rate.updateMany({
          where: { kind: "CRYPTO", symbol },
          data: { sellRateNgn: desk[symbol].sell, buyRateNgn: desk[symbol].buy },
        }),
      ),
    );
  } catch {
    /* keep zeros */
  }

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12">
        <p className="badge">Live rate calculator</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-bold text-ink">
          Know your payout before you trade
        </h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Enter an amount, pick your asset, and see what you’ll receive in Naira — updated live
          {fetchedAt ? ` · ${formatClockTime(fetchedAt)}` : ""}.
        </p>

        <div className="mt-10 grid gap-8 lg:grid-cols-2">
          <RateCalculator desk={desk} />
          <div className="card-panel flex flex-col justify-center">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold">
              Best rates. Fast payouts.
            </h2>
            <p className="mt-3 text-sm text-ink-soft">
              What the calculator shows is what you get when you lock an order — no hidden fees.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-ink-soft">
              <li>Live rates refresh automatically</li>
              <li>Most sells settle to your bank after confirmation</li>
              <li>Crypto and gift cards in one place</li>
            </ul>
            <Link href={user ? "/dashboard/sell-crypto" : "/register"} className="btn btn-primary mt-8 inline-flex w-fit">
              {user ? "Continue to trade" : "Create free account"}
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
