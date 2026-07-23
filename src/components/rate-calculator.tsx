"use client";

import { useMemo, useState } from "react";
import { formatNgn } from "@/lib/format";

type Desk = {
  USDT: { mid: number; sell: number; buy: number };
  BTC: { mid: number; sell: number; buy: number };
  ETH: { mid: number; sell: number; buy: number };
};

const ASSETS = [
  { id: "USDT", label: "Tether (USDT TRC20)", unit: "USDT" },
  { id: "BTC", label: "Bitcoin (BTC)", unit: "BTC" },
  { id: "ETH", label: "Ethereum (ETH)", unit: "ETH" },
] as const;

export function RateCalculator({ desk }: { desk: Desk }) {
  const [side, setSide] = useState<"sell" | "buy">("sell");
  const [asset, setAsset] = useState<(typeof ASSETS)[number]["id"]>("USDT");
  const [amount, setAmount] = useState("100");

  const quote = useMemo(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    const row = desk[asset];
    const rate = side === "sell" ? row.sell : row.buy;
    return { rate, payout: n * rate };
  }, [amount, asset, desk, side]);

  return (
    <div className="card-panel">
      <div className="flex gap-2">
        <button
          type="button"
          className={`btn flex-1 text-sm ${side === "sell" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setSide("sell")}
        >
          Sell
        </button>
        <button
          type="button"
          className={`btn flex-1 text-sm ${side === "buy" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setSide("buy")}
        >
          Buy
        </button>
      </div>

      <label className="mt-4 block text-sm font-medium">
        Asset
        <select
          className="input mt-1"
          value={asset}
          onChange={(e) => setAsset(e.target.value as typeof asset)}
        >
          {ASSETS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-4 block text-sm font-medium">
        Amount ({ASSETS.find((a) => a.id === asset)?.unit})
        <input
          className="input mt-1"
          type="number"
          min="0"
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>

      <div className="mt-5 rounded-xl bg-paper-deep p-4">
        <p className="text-xs uppercase tracking-wide text-ink-soft">
          {side === "sell" ? "You receive" : "You pay"} ·{" "}
          {quote ? formatNgn(quote.rate) : "N/A"}/{ASSETS.find((a) => a.id === asset)?.unit}
        </p>
        <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">
          {quote ? formatNgn(quote.payout) : "₦0"}
        </p>
      </div>
      <p className="mt-3 text-xs text-ink-soft">
        Indicative. Final rate locks when you create an order.
      </p>
    </div>
  );
}
