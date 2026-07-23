import { redirect } from "next/navigation";
import { createGiftCardSellAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";

export default async function SellGiftCardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const rates = await prisma.rate.findMany({
    where: { kind: "GIFTCARD", isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="mx-auto max-w-xl">
      <p className="section-label">Gift card</p>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">
        Sell gift card for Naira
      </h1>
      <p className="step-strip mt-4">
        <span>
          <strong>1.</strong> Brand + face value
        </span>
        <span>
          <strong>2.</strong> Submit code (encrypted)
        </span>
        <span>
          <strong>3.</strong> Desk pays out
        </span>
      </p>

      <ul className="mt-6 space-y-2 text-sm">
        {rates.map((r) => (
          <li key={r.id} className="flex justify-between rounded-xl bg-paper-deep/80 px-3 py-2">
            <span>{r.displayName} / $1</span>
            <span className="font-semibold">{formatNgn(r.sellRateNgn)}</span>
          </li>
        ))}
      </ul>

      <div className="ops-hint mt-6">
        Codes are encrypted with AES-256-GCM before storage. Only the desk decrypts during verification.
      </div>

      <ActionForm action={createGiftCardSellAction} className="panel mt-6" submitLabel="Submit gift card">
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
    </div>
  );
}
