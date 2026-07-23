import { redirect } from "next/navigation";
import { createCryptoSellAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";

export default async function SellCryptoPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const rates = await prisma.rate.findMany({
    where: { kind: "CRYPTO", isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const wallets = await prisma.platformWallet.findMany({ where: { isActive: true } });

  return (
    <div className="mx-auto max-w-xl">
      <p className="section-label">Sell crypto</p>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">
        Send crypto, get Naira
      </h1>
      <p className="step-strip mt-4">
        <span>
          <strong>1.</strong> Amount
        </span>
        <span>
          <strong>2.</strong> Send to deposit address
        </span>
        <span>
          <strong>3.</strong> Paste TX on Orders
        </span>
      </p>

      <ul className="mt-6 space-y-2 text-sm">
        {rates.map((r) => (
          <li key={r.id} className="flex justify-between rounded-xl bg-paper-deep/80 px-3 py-2">
            <span>{r.symbol} sell</span>
            <span className="font-semibold">{formatNgn(r.sellRateNgn)}</span>
          </li>
        ))}
      </ul>

      <ActionForm action={createCryptoSellAction} className="panel mt-6" submitLabel="Create sell order">
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

      <div className="mt-6 space-y-3">
        <p className="font-semibold text-sm">Active deposit wallets</p>
        {wallets.map((w) => (
          <div key={w.id} className="ops-hint">
            <p className="font-medium text-ink">
              {w.symbol} · {w.network}
            </p>
            <code className="mt-1 block break-all text-xs text-ink">{w.address}</code>
            {w.note && <p className="mt-2 text-xs text-amber-900">{w.note}</p>}
          </div>
        ))}
        {wallets.length === 0 && <p className="text-sm text-ink-soft">No deposit wallets configured.</p>}
      </div>
    </div>
  );
}
