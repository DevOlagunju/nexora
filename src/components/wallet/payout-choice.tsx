import { formatNgn } from "@/lib/format";

type Option = { value: string; title: string; detail: string; disabled?: boolean };

/** Radio cards. Plain form inputs, so they work inside ActionForm without client state. */
export function ChoiceCards({ name, legend, options, defaultValue }: {
  name: string;
  legend: string;
  options: Option[];
  defaultValue: string;
}) {
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.value} className={`choice-card${o.disabled ? " is-disabled" : ""}`}>
            <input
              type="radio"
              name={name}
              value={o.value}
              defaultChecked={o.value === defaultValue}
              disabled={o.disabled}
              className="sr-only"
            />
            <span className="block text-sm font-semibold text-ink">{o.title}</span>
            <span className="mt-0.5 block text-xs text-ink-soft">{o.detail}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Where sell proceeds go. Wallet is the default: instant credit on approval, withdraw any time. */
export function PayoutChoice({ bankLabel }: { bankLabel: string | null }) {
  return (
    <ChoiceCards
      name="payoutMethod"
      legend="Receive Naira in"
      defaultValue="WALLET"
      options={[
        { value: "WALLET", title: "Nexora wallet", detail: "Credited the moment the desk approves. Withdraw any time." },
        { value: "BANK", title: "Bank account", detail: bankLabel ? `Paid to ${bankLabel}` : "Your verified bank account" },
      ]}
    />
  );
}

export function PayFromChoice({ balance, instant = false }: { balance: number; instant?: boolean }) {
  return (
    <ChoiceCards
      name="payFrom"
      legend="Pay with"
      defaultValue={instant ? "CARD" : "BANK"}
      options={[
        ...(instant
          ? [{ value: "CARD", title: "Card or instant transfer", detail: "Card, virtual card, transfer or USSD. Confirmed instantly." }]
          : []),
        { value: "BANK", title: "Manual bank transfer", detail: "Transfer to the desk account, then add your reference." },
        {
          value: "WALLET",
          title: "Wallet balance",
          detail: balance > 0 ? `${formatNgn(balance)} available. Paid instantly.` : "Your wallet is empty.",
          disabled: balance <= 0,
        },
      ]}
    />
  );
}
