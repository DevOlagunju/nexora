import { redirect } from "next/navigation";
import { createCryptoSellAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export default async function SellCryptoPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const rates = await prisma.rate.findMany({
    where: { kind: "CRYPTO", isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const wallets = await prisma.platformWallet.findMany({ where: { isActive: true } });

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">Sell crypto</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Create an order, send assets to the shown deposit address, then paste your TX hash on Orders.
        </p>

        <ul className="mt-6 space-y-2 text-sm">
          {rates.map((r) => (
            <li key={r.id} className="flex justify-between rounded-xl bg-paper-deep px-3 py-2">
              <span>{r.symbol} sell</span>
              <span className="font-semibold">{formatNgn(r.sellRateNgn)}</span>
            </li>
          ))}
        </ul>

        <ActionForm action={createCryptoSellAction} className="card-panel mt-6">
          <label className="block text-sm font-medium">
            Asset
            <select className="input mt-1" name="symbol" required defaultValue="USDT">
              {rates.map((r) => (
                <option key={r.symbol} value={r.symbol}>
                  {r.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 block text-sm font-medium">
            Amount
            <input className="input mt-1" name="amountCrypto" type="number" step="any" required />
          </label>
          <label className="mt-4 block text-sm font-medium">
            TX hash (optional now)
            <input className="input mt-1" name="txHash" placeholder="Paste after sending" />
          </label>
        </ActionForm>

        <div className="card-panel mt-6 text-sm">
          <p className="font-semibold">Active deposit wallets</p>
          <ul className="mt-3 space-y-2 text-ink-soft">
            {wallets.map((w) => (
              <li key={w.id}>
                <span className="font-medium text-ink">
                  {w.symbol} · {w.network}
                </span>
                <br />
                <code className="break-all text-xs">{w.address}</code>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
