import { redirect } from "next/navigation";
import { createGiftCardSellAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export default async function SellGiftCardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const rates = await prisma.rate.findMany({
    where: { kind: "GIFTCARD", isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold">Sell gift card</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Codes are encrypted before they touch the database. Desk verifies then pays Naira to your KYC
          bank account.
        </p>

        <ul className="mt-6 space-y-2 text-sm">
          {rates.map((r) => (
            <li key={r.id} className="flex justify-between rounded-xl bg-paper-deep px-3 py-2">
              <span>{r.displayName} / $1</span>
              <span className="font-semibold">{formatNgn(r.sellRateNgn)}</span>
            </li>
          ))}
        </ul>

        <ActionForm action={createGiftCardSellAction} className="card-panel mt-6">
          <label className="block text-sm font-medium">
            Brand
            <select className="input mt-1" name="brand" required>
              {rates.map((r) => (
                <option key={r.symbol} value={r.symbol}>
                  {r.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 block text-sm font-medium">
            Country
            <input className="input mt-1" name="country" defaultValue="USA" required />
          </label>
          <label className="mt-4 block text-sm font-medium">
            Face value (USD)
            <input className="input mt-1" name="faceValueUsd" type="number" step="any" required />
          </label>
          <label className="mt-4 block text-sm font-medium">
            Card code
            <input className="input mt-1" name="cardCode" required autoComplete="off" />
          </label>
        </ActionForm>
      </main>
      <SiteFooter />
    </>
  );
}
