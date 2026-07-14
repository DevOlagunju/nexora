import { redirect } from "next/navigation";
import { createCryptoBuyAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { platformBankDetails } from "@/lib/platform-bank";
import { ActionForm } from "@/components/action-form";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export default async function BuyCryptoPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const rates = await prisma.rate.findMany({
    where: { kind: "CRYPTO", isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  const bank = platformBankDetails();

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">Buy crypto</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Pay Naira to our desk account, then we send crypto to your wallet after verification.
        </p>

        <ul className="mt-6 space-y-2 text-sm">
          {rates.map((r) => (
            <li key={r.id} className="flex justify-between rounded-xl bg-paper-deep px-3 py-2">
              <span>{r.symbol} buy</span>
              <span className="font-semibold">{formatNgn(r.buyRateNgn)}</span>
            </li>
          ))}
        </ul>

        <div className="card-panel mt-6 text-sm">
          <p className="font-semibold">Pay into</p>
          <p className="mt-2 text-ink-soft">
            {bank.accountName}
            <br />
            {bank.bankName}
            <br />
            <code className="text-ink">{bank.accountNumber}</code>
          </p>
        </div>

        <ActionForm action={createCryptoBuyAction} className="card-panel mt-6">
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
      </main>
      <SiteFooter />
    </>
  );
}
