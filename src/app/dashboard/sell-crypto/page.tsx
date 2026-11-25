import { redirect } from "next/navigation";
import { createCryptoSellAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { PayoutChoice } from "@/components/wallet/payout-choice";
import { listAssetNetworks } from "@/lib/services/assets";

export default async function SellCryptoPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const rates = await prisma.rate.findMany({
    where: { kind: "CRYPTO", isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const wallets = (await listAssetNetworks({ includeAddresses: true })).filter((w) => w.sell);
  const networkCodes = [...new Set(wallets.map((w) => w.network))];
  const kyc = await prisma.kycProfile.findUnique({ where: { userId: user.id } });
  const bankLabel = kyc?.bankName && kyc.accountNumber ? `${kyc.bankName} ••${kyc.accountNumber.slice(-4)}` : null;


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
        {networkCodes.length > 1 && (
          <label className="mt-4 block text-sm font-medium">
            Network
            <select className="input mt-1" name="network" defaultValue="">
              <option value="">Default for this asset</option>
              {networkCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs font-normal text-ink-soft">
              Send only on the network your order shows. Each network is listed below.
            </span>
          </label>
        )}
        <label className="mt-4 block text-sm font-medium">
          Amount
          <input className="input mt-1" name="amountCrypto" type="number" step="any" required />
        </label>
        <label className="mt-4 block text-sm font-medium">
          TX hash (optional now)
          <input className="input mt-1" name="txHash" placeholder="Paste after sending" />
        </label>
        <PayoutChoice bankLabel={bankLabel} />
      </ActionForm>

      <div className="mt-6 space-y-3">
        <p className="font-semibold text-sm">Active deposit wallets</p>
        {wallets.map((w) => (
          <div key={`${w.symbol}-${w.network}`} className="ops-hint">
            <p className="font-medium text-ink">
              {w.symbol} · {w.networkName}
              {w.isDefault && <span className="ml-2 text-xs font-normal text-ink-soft">default</span>}
            </p>
            <code className="mt-1 block break-all text-xs text-ink">{w.depositAddress}</code>
            {w.depositMemo && <p className="mt-1 text-xs text-ink">Memo: {w.depositMemo}</p>}
            <p className="mt-1 text-xs text-ink-soft">Credited after {w.confirmations} confirmation{w.confirmations === 1 ? "" : "s"}.</p>
            {w.note && <p className="mt-2 text-xs text-amber-900">{w.note}</p>}
          </div>
        ))}
        {wallets.length === 0 && <p className="text-sm text-ink-soft">No deposit wallets configured.</p>}
      </div>
    </div>
  );
}
