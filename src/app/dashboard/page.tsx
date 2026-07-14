import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/security";
import { formatNgn } from "@/lib/format";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [kyc, cryptoOrders, giftOrders] = await Promise.all([
    prisma.kycProfile.findUnique({ where: { userId: user.id } }),
    prisma.cryptoOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.giftCardOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-ink-soft">Signed in as {user.email}</p>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">
              Hi, {user.fullName.split(" ")[0]}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/kyc" className="btn btn-ghost text-sm">
              KYC · {kyc?.status ?? "UNVERIFIED"}
            </Link>
            <Link href="/dashboard/sell-crypto" className="btn btn-primary text-sm">
              Sell crypto
            </Link>
            <Link href="/dashboard/buy-crypto" className="btn btn-ghost text-sm">
              Buy crypto
            </Link>
            <Link href="/dashboard/sell-giftcard" className="btn btn-dark text-sm">
              Sell gift card
            </Link>
          </div>
        </div>

        {kyc?.status !== "APPROVED" && (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Complete KYC before trading.{" "}
            <Link href="/dashboard/kyc" className="font-semibold underline">
              Submit verification
            </Link>
          </div>
        )}

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <section className="card-panel">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Recent crypto orders</h2>
              <Link href="/dashboard/orders" className="text-sm text-accent-deep">
                All orders
              </Link>
            </div>
            <ul className="mt-4 space-y-3 text-sm">
              {cryptoOrders.length === 0 && <li className="text-ink-soft">No crypto orders yet.</li>}
              {cryptoOrders.map((o) => (
                <li key={o.id} className="flex justify-between gap-3 border-b border-[var(--line)] pb-2">
                  <span>
                    {o.reference}
                    <span className="block text-xs text-ink-soft">
                      {o.side} · {o.amountCrypto} {o.symbol}
                    </span>
                  </span>
                  <span className="text-right">
                    {formatNgn(o.amountNgn)}
                    <span className="block text-xs text-ink-soft">{STATUS_LABEL[o.status]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card-panel">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Recent gift card sells</h2>
              <Link href="/dashboard/orders" className="text-sm text-accent-deep">
                All orders
              </Link>
            </div>
            <ul className="mt-4 space-y-3 text-sm">
              {giftOrders.length === 0 && <li className="text-ink-soft">No gift card orders yet.</li>}
              {giftOrders.map((o) => (
                <li key={o.id} className="flex justify-between gap-3 border-b border-[var(--line)] pb-2">
                  <span>
                    {o.reference}
                    <span className="block text-xs text-ink-soft">
                      {o.brand} · ${o.faceValueUsd}
                    </span>
                  </span>
                  <span className="text-right">
                    {formatNgn(o.amountNgn)}
                    <span className="block text-xs text-ink-soft">{STATUS_LABEL[o.status]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
