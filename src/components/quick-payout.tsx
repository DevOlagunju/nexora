"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatNgn } from "@/lib/format";

type RateOption = {
  symbol: string;
  displayName: string;
  sellRateNgn: number;
  kind: "CRYPTO" | "GIFTCARD";
};

const PRESETS = [50, 100, 200, 500] as const;

function shortLabel(o: RateOption) {
  if (o.kind === "CRYPTO") return o.symbol;
  if (o.symbol === "GOOGLE") return "Google";
  return o.displayName.replace(/ Gift Card$/i, "");
}

export function QuickPayout({
  options,
  ctaHref,
}: {
  options: RateOption[];
  ctaHref: string;
}) {
  const first = options[0];
  const [symbol, setSymbol] = useState(first?.symbol ?? "USDT");
  const [amount, setAmount] = useState("100");

  const selected = useMemo(
    () => options.find((o) => o.symbol === symbol) ?? first,
    [options, symbol, first],
  );

  const qty = Number(amount);
  const payout =
    selected && Number.isFinite(qty) && qty > 0 ? qty * selected.sellRateNgn : null;
  const unit = selected?.kind === "GIFTCARD" ? "USD" : (selected?.symbol ?? "");

  if (!selected) return null;

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[0_10px_32px_rgba(7,16,24,0.05)]">
      <p className="text-[15px] font-extrabold tracking-tight text-ink">Quick estimate</p>
      <p className="mt-1 text-xs text-[var(--muted)]">See your NGN payout before you trade.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {options.map((o) => {
          const on = o.symbol === symbol;
          return (
            <button
              key={o.symbol}
              type="button"
              onClick={() => setSymbol(o.symbol)}
              className={
                on
                  ? "rounded-full bg-ink px-3 py-1.5 text-xs font-bold text-white"
                  : "rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-bold text-ink-soft hover:border-accent"
              }
            >
              {shortLabel(o)}
            </button>
          );
        })}
      </div>

      <label className="mt-4 block text-xs font-bold text-ink-soft">
        Amount ({unit})
        <input
          className="input mt-1.5"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="100"
        />
      </label>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const on = amount === String(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => setAmount(String(p))}
              className={
                on
                  ? "rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-accent-deep"
                  : "rounded-lg bg-paper-deep px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-emerald-50 hover:text-accent-deep"
              }
            >
              {p}
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-accent-deep">
          Estimated payout
        </p>
        <p
          key={payout ?? "empty"}
          className="animate-pop mt-1 font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight text-ink tabular-nums"
        >
          {payout != null ? formatNgn(payout) : "—"}
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Desk rate {formatNgn(selected.sellRateNgn)}
          {selected.kind === "GIFTCARD" ? " per $1" : ` · ${selected.symbol}`}
        </p>
      </div>

      <Link href={ctaHref} className="btn btn-dark mt-4 w-full justify-center">
        Trade this rate
      </Link>
    </div>
  );
}
