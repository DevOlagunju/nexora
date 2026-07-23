import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { StatusPill } from "@/components/status-pill";

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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-label">Overview</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">
            Hi, {user.fullName.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{user.email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/sell-crypto" className="btn btn-primary text-sm">
            Sell crypto
          </Link>
          <Link href="/dashboard/buy-crypto" className="btn btn-ghost text-sm">
            Buy
          </Link>
          <Link href="/dashboard/sell-giftcard" className="btn btn-dark text-sm">
            Gift card
          </Link>
        </div>
      </div>

      {kyc?.status !== "APPROVED" && (
        <div className="ops-hint mt-6">
          Complete KYC before trading.{" "}
          <Link href="/dashboard/kyc" className="font-semibold text-ink underline">
            Submit verification
          </Link>
          {kyc?.status && (
            <span className="ml-2 inline-block align-middle">
              <StatusPill status={kyc.status} />
            </span>
          )}
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Recent crypto</h2>
            <Link href="/dashboard/orders" className="text-sm font-medium text-accent-deep">
              All orders
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-[var(--line)] border-t border-[var(--line)] text-sm">
            {cryptoOrders.length === 0 && (
              <li className="py-4 text-ink-soft">No crypto orders yet.</li>
            )}
            {cryptoOrders.map((o) => (
              <li key={o.id} className="flex justify-between gap-3 py-3">
                <span>
                  <span className="font-medium">{o.reference}</span>
                  <span className="block text-xs text-ink-soft">
                    {o.side} · {o.amountCrypto} {o.symbol}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-medium">{formatNgn(o.amountNgn)}</span>
                  <span className="mt-1 inline-block">
                    <StatusPill status={o.status} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Recent gift cards</h2>
            <Link href="/dashboard/orders" className="text-sm font-medium text-accent-deep">
              All orders
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-[var(--line)] border-t border-[var(--line)] text-sm">
            {giftOrders.length === 0 && (
              <li className="py-4 text-ink-soft">No gift card orders yet.</li>
            )}
            {giftOrders.map((o) => (
              <li key={o.id} className="flex justify-between gap-3 py-3">
                <span>
                  <span className="font-medium">{o.reference}</span>
                  <span className="block text-xs text-ink-soft">
                    {o.brand} · ${o.faceValueUsd}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-medium">{formatNgn(o.amountNgn)}</span>
                  <span className="mt-1 inline-block">
                    <StatusPill status={o.status} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
