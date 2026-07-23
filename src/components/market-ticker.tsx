"use client";

import { useCallback, useEffect, useState } from "react";
import { formatPriceUsd, type MarketRow } from "@/lib/markets";

type MarketsResponse = {
  markets: MarketRow[];
};

function TickerChip({ row }: { row: MarketRow }) {
  const change = row.change24h;
  const up = change != null && change >= 0;
  const down = change != null && change < 0;

  return (
    <div className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--line)] bg-white px-3 py-1.5 shadow-[0_2px_8px_rgba(7,16,24,0.04)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={row.image}
        alt=""
        className="h-5 w-5 shrink-0 rounded-full bg-paper-deep object-cover"
        width={20}
        height={20}
      />
      <span className="text-[13px] font-extrabold tracking-tight text-ink">
        {row.symbol.toUpperCase()}
        <span className="font-semibold text-ink-soft">${formatPriceUsd(row.price)}</span>
      </span>
      {change != null ? (
        <span
          className={`inline-flex shrink-0 items-center gap-0.5 text-[11px] font-bold tabular-nums ${
            up ? "text-accent-deep" : down ? "text-danger" : "text-[var(--muted)]"
          }`}
        >
          <span aria-hidden className="text-[9px]">
            {up ? "▲" : "▼"}
          </span>
          {Math.abs(change).toFixed(2)}%
        </span>
      ) : null}
    </div>
  );
}

export function MarketTicker({ initial }: { initial: MarketRow[] }) {
  const [markets, setMarkets] = useState(initial);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/markets", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as MarketsResponse;
      if (data.markets?.length) setMarkets(data.markets);
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 45_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!markets.length) return null;

  const rows = markets.slice(0, 16);
  const renderTrack = (prefix: string) =>
    rows.map((row) => <TickerChip key={`${prefix}-${row.id}`} row={row} />);

  return (
    <div
      className="group relative overflow-hidden border-y border-[var(--line)] bg-white/95 py-2.5"
      aria-label="Live crypto prices"
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-white to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-white to-transparent"
        aria-hidden
      />

      <div className="overflow-hidden">
        <div className="market-ticker__track flex w-max flex-row flex-nowrap items-center">
          <div className="flex shrink-0 flex-row flex-nowrap items-center gap-3 px-2">
            {renderTrack("a")}
          </div>
          <div className="flex shrink-0 flex-row flex-nowrap items-center gap-3 px-2" aria-hidden>
            {renderTrack("b")}
          </div>
        </div>
      </div>
    </div>
  );
}
