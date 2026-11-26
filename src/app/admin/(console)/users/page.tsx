import { SectionLink as Link } from "@/components/admin/section-link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { ago } from "@/lib/admin-overview-rules";
import { StatusPill } from "@/components/status-pill";
import { SearchIcon } from "@/components/admin/icons";

export const metadata = { title: "Users · Nexora admin" };

const PAGE = 50;

/**
 * Customers, newest first, and the top-bar search: matches customers by name, email or phone,
 * and orders or withdrawals by reference.
 */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const text = q ? { contains: q, mode: "insensitive" as const } : undefined;

  const [users, total, crypto, gift, withdrawals] = await Promise.all([
    prisma.user.findMany({
      where: { role: "USER", ...(text ? { OR: [{ fullName: text }, { email: text }, { phone: { contains: q } }] } : {}) },
      orderBy: { createdAt: "desc" },
      take: PAGE,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        createdAt: true,
        walletBalanceNgn: true,
        kyc: { select: { status: true } },
        _count: { select: { cryptoOrders: true, giftOrders: true } },
      },
    }),
    prisma.user.count({ where: { role: "USER" } }),
    text ? prisma.cryptoOrder.findMany({ where: { reference: text }, take: 10, orderBy: { createdAt: "desc" }, include: { user: { select: { email: true } } } }) : [],
    text ? prisma.giftCardOrder.findMany({ where: { reference: text }, take: 10, orderBy: { createdAt: "desc" }, include: { user: { select: { email: true } } } }) : [],
    text ? prisma.withdrawal.findMany({ where: { reference: text }, take: 10, orderBy: { createdAt: "desc" }, include: { user: { select: { email: true } } } }) : [],
  ]);
  const refs = [
    ...crypto.map((o) => ({ ref: o.reference, kind: `${o.side === "SELL" ? "Sell" : "Buy"} ${o.amountCrypto} ${o.symbol}`, who: o.user.email, amount: o.amountNgn, status: o.status, href: "/admin/desk#crypto" })),
    ...gift.map((o) => ({ ref: o.reference, kind: `Gift card $${o.faceValueUsd} ${o.brand}`, who: o.user.email, amount: o.amountNgn, status: o.status, href: "/admin/desk#gift" })),
    ...withdrawals.map((w) => ({ ref: w.reference, kind: "Withdrawal", who: w.user.email, amount: w.amountNgn, status: w.status, href: "/admin/desk#withdrawals" })),
  ];

  return (
    <div className="mx-auto max-w-[96rem]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-ink">{q ? `Results for “${q}”` : "Users"}</h1>
          <p className="mt-1 text-ink-soft">
            {q ? `${users.length} customer${users.length === 1 ? "" : "s"} and ${refs.length} order${refs.length === 1 ? "" : "s"} found.` : `${total.toLocaleString("en-NG")} customers in total. Newest first.`}
          </p>
        </div>
        <form className="admin-search min-w-[18rem]" role="search">
          <SearchIcon className="h-5 w-5 text-[var(--muted)]" />
          <input name="q" defaultValue={q} placeholder="Name, email, phone or reference" aria-label="Search" />
        </form>
      </div>

      {refs.length > 0 ? (
        <section className="admin-card mt-6 p-5">
          <h2 className="text-lg font-bold text-ink">Orders and withdrawals</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-[var(--muted)]">
                  <th className="pb-2 font-semibold">Reference</th>
                  <th className="pb-2 font-semibold">What</th>
                  <th className="pb-2 font-semibold">Customer</th>
                  <th className="pb-2 font-semibold">Amount</th>
                  <th className="pb-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {refs.map((r) => (
                  <tr key={r.ref}>
                    <td className="py-2.5 font-mono text-xs">
                      <Link href={r.href} className="font-bold text-accent-deep hover:underline">
                        {r.ref}
                      </Link>
                    </td>
                    <td className="py-2.5 text-ink">{r.kind}</td>
                    <td className="py-2.5 text-ink-soft">{r.who}</td>
                    <td className="py-2.5 font-bold text-ink">{formatNgn(r.amount)}</td>
                    <td className="py-2.5">
                      <StatusPill status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="admin-card mt-6 p-5">
        {users.length === 0 ? (
          <p className="text-sm text-ink-soft">{q ? "No customer matches that." : "No customers yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-[var(--muted)]">
                  <th className="pb-2 font-semibold">Customer</th>
                  <th className="pb-2 font-semibold">Phone</th>
                  <th className="pb-2 font-semibold">KYC</th>
                  <th className="pb-2 font-semibold">Wallet</th>
                  <th className="pb-2 font-semibold">Orders</th>
                  <th className="pb-2 text-right font-semibold">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-deep">
                          {u.fullName.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-bold text-ink">{u.fullName}</p>
                          <p className="truncate text-xs text-ink-soft">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 text-ink-soft">{u.phone}</td>
                    <td className="py-3">
                      <StatusPill status={u.kyc?.status === "APPROVED" ? "VERIFIED" : (u.kyc?.status ?? "UNVERIFIED")} />
                    </td>
                    <td className="py-3 font-bold text-ink">{formatNgn(u.walletBalanceNgn)}</td>
                    <td className="py-3 text-ink-soft">{u._count.cryptoOrders + u._count.giftOrders}</td>
                    <td className="py-3 text-right text-xs text-[var(--muted)]">{ago(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!q && total > PAGE ? <p className="mt-3 text-xs text-[var(--muted)]">Showing the newest {PAGE}. Search to find anyone else.</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}
