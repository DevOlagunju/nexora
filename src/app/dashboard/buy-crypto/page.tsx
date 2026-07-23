import { redirect } from "next/navigation";
import { createCryptoBuyAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { platformBankDetails } from "@/lib/platform-bank";
import { ActionForm } from "@/components/action-form";

export default async function BuyCryptoPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const rates = await prisma.rate.findMany({
    where: { kind: "CRYPTO", isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const bank = platformBankDetails();

  return (
    <div className="mx-auto max-w-xl">
      <p className="section-label">Buy crypto</p>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">
        Pay Naira, receive crypto
      </h1>
      <p className="step-strip mt-4">
        <span>
          <strong>1.</strong> Amount + wallet
        </span>
        <span>
          <strong>2.</strong> Pay desk bank
        </span>
        <span>
          <strong>3.</strong> Paste payment ref
        </span>
      </p>

      <ul className="mt-6 space-y-2 text-sm">
        {rates.map((r) => (
          <li key={r.id} className="flex justify-between rounded-xl bg-paper-deep/80 px-3 py-2">
            <span>{r.symbol} buy</span>
            <span className="font-semibold">{formatNgn(r.buyRateNgn)}</span>
          </li>
        ))}
      </ul>

      <div className="ops-hint mt-6">
        <p className="font-medium text-ink">Pay into</p>
        <p className="mt-1">
          {bank.accountName}
          <br />
          {bank.bankName}
          <br />
          <code className="text-ink">{bank.accountNumber}</code>
        </p>
      </div>

      <ActionForm action={createCryptoBuyAction} className="panel mt-6" submitLabel="Create buy order">
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
          Amount (crypto)
          <input className="input mt-1" name="amountCrypto" type="number" step="any" required />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Your receive wallet address
          <input
            className="input mt-1"
            name="userReceiveAddress"
            placeholder="Paste wallet address"
            required
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Bank payment reference (optional now)
          <input className="input mt-1" name="paymentRef" placeholder="Paste after paying" />
        </label>
      </ActionForm>
    </div>
  );
}
