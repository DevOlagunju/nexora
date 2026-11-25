import { redirect } from "next/navigation";
import { createGiftCardSellAction } from "@/app/actions";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatNgn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { PayoutChoice } from "@/components/wallet/payout-choice";
import { listGiftCardBrands } from "@/lib/services/giftcards";
import { CARD_TYPE_LABEL, countryName } from "@/lib/giftcard-rules";

export default async function SellGiftCardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const brands = await listGiftCardBrands();
  const countries = [...new Set(brands.flatMap((b) => b.variants.map((v) => v.country)))];
  const kyc = await prisma.kycProfile.findUnique({ where: { userId: user.id } });
  const bankLabel = kyc?.bankName && kyc.accountNumber ? `${kyc.bankName} ••${kyc.accountNumber.slice(-4)}` : null;

  return (
    <div className="mx-auto max-w-xl">
      <p className="section-label">Gift card</p>
      <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold">
        Sell gift card for Naira
      </h1>
      <p className="step-strip mt-4">
        <span>
          <strong>1.</strong> Brand, country, type
        </span>
        <span>
          <strong>2.</strong> Submit code (encrypted)
        </span>
        <span>
          <strong>3.</strong> Desk pays out
        </span>
      </p>

      <div className="mt-6 space-y-4 text-sm">
        {brands.map((b) => (
          <div key={b.brand}>
            <p className="font-semibold">{b.displayName}</p>
            <ul className="mt-2 space-y-1">
              {b.variants.map((v) => (
                <li key={`${v.country}-${v.cardType}`} className="flex justify-between rounded-xl bg-paper-deep/80 px-3 py-2">
                  <span>
                    {countryName(v.country)} · {CARD_TYPE_LABEL[v.cardType]}
                    {v.denominations.length > 0 && (
                      <span className="text-xs text-ink-soft"> · ${v.denominations.join(", $")}</span>
                    )}
                  </span>
                  <span className="font-semibold">{formatNgn(v.rateNgn)} / $1</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {brands.length === 0 && <p className="text-ink-soft">We are not buying gift cards right now.</p>}
      </div>

      <div className="ops-hint mt-6">
        Codes are encrypted with AES-256-GCM before storage. Only the desk decrypts during verification.
      </div>

      <ActionForm action={createGiftCardSellAction} className="panel mt-6" submitLabel="Submit gift card">
        <label className="block text-sm font-medium">
          Brand
          <select className="input mt-1" name="brand" required>
            {brands.map((b) => (
              <option key={b.brand} value={b.brand}>
                {b.displayName}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            Country
            <select className="input mt-1" name="country" required defaultValue={countries.includes("US") ? "US" : countries[0]}>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {countryName(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Card type
            <select className="input mt-1" name="cardType" required defaultValue="ECODE">
              <option value="ECODE">{CARD_TYPE_LABEL.ECODE}</option>
              <option value="PHYSICAL">{CARD_TYPE_LABEL.PHYSICAL}</option>
            </select>
          </label>
        </div>
        <label className="mt-4 block text-sm font-medium">
          Face value (USD)
          <input className="input mt-1" name="faceValueUsd" type="number" step="any" required />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Card code
          <input className="input mt-1" name="cardCode" required autoComplete="off" />
        </label>
        <PayoutChoice bankLabel={bankLabel} />
      </ActionForm>
    </div>
  );
}
