"use client";

import { useEffect, useRef, useState } from "react";
import { lookupBankAccountAction } from "@/app/actions";
import type { Bank } from "@/lib/bank-rules";

type Lookup =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "found"; accountName: string; nameMatch: boolean; mode: "live" | "test" }
  | { state: "error"; error: string };

/** Popular banks first, the rest alphabetical: most Nigerian customers use one of these. */
const POPULAR = ["058", "044", "057", "033", "011", "50211", "999992", "999991", "50515", "070", "232", "035"];

/**
 * Bank picker + account number with live name lookup. Renders form inputs named
 * bankCode / accountNumber so it drops into the existing KYC server-action form.
 */
export function BankAccountField({ banks, live }: { banks: Bank[]; live: boolean }) {
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const seq = useRef(0);

  const popular = POPULAR.map((c) => banks.find((b) => b.code === c)).filter((b): b is Bank => !!b);
  const rest = banks.filter((b) => !POPULAR.includes(b.code));

  useEffect(() => {
    if (!bankCode || accountNumber.length !== 10) return;
    const id = ++seq.current;
    const t = window.setTimeout(async () => {
      setLookup({ state: "loading" });
      const res = await lookupBankAccountAction({ bankCode, accountNumber });
      if (id !== seq.current) return; // a newer lookup superseded this one
      setLookup(
        res.ok
          ? { state: "found", accountName: res.accountName, nameMatch: res.nameMatch, mode: res.mode }
          : { state: "error", error: res.error },
      );
    }, 350);
    return () => window.clearTimeout(t);
  }, [bankCode, accountNumber]);

  const reset = () => {
    seq.current++;
    setLookup({ state: "idle" });
  };

  return (
    <div className="mt-4 space-y-4">
      <label className="block text-sm font-medium">
        Bank
        <select
          className="input mt-1"
          name="bankCode"
          required
          value={bankCode}
          onChange={(e) => {
            setBankCode(e.target.value);
            reset();
          }}
        >
          <option value="" disabled>
            Choose your bank
          </option>
          <optgroup label="Popular">
            {popular.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="All banks">
            {rest.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <label className="block text-sm font-medium">
        Account number
        <input
          className="input mt-1 tabular-nums tracking-wider"
          name="accountNumber"
          inputMode="numeric"
          autoComplete="off"
          required
          maxLength={10}
          pattern="[0-9]{10}"
          placeholder="10-digit NUBAN"
          value={accountNumber}
          onChange={(e) => {
            setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10));
            reset();
          }}
        />
      </label>

      <div aria-live="polite">
        {lookup.state === "loading" && (
          <p className="rounded-xl bg-paper-deep/70 px-3 py-2.5 text-sm text-ink-soft">Checking with your bank…</p>
        )}
        {lookup.state === "error" && (
          <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-danger" role="alert">
            {lookup.error}
          </p>
        )}
        {lookup.state === "found" && (
          <div
            className={`rounded-xl border px-3.5 py-3 text-sm ${lookup.nameMatch ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Account name</p>
            <p className="mt-0.5 text-base font-bold text-ink">{lookup.accountName}</p>
            <p className={`mt-1 text-xs ${lookup.nameMatch ? "text-accent-deep" : "text-amber-900"}`}>
              {lookup.nameMatch
                ? "✓ Matches the name on your Nexora account."
                : "This name doesn't match your Nexora account. Payouts must go to an account in your own name, so the desk may ask you to confirm."}
            </p>
            {lookup.mode === "test" && (
              <p className="mt-1 text-xs text-[var(--muted)]">Test mode: Paystack isn&apos;t connected, so this name is a placeholder.</p>
            )}
          </div>
        )}
        {lookup.state === "idle" && (
          <p className="text-xs text-[var(--muted)]">
            {live
              ? "We'll confirm the account name with your bank automatically."
              : "Pick your bank and enter your 10-digit account number."}
          </p>
        )}
      </div>
    </div>
  );
}
