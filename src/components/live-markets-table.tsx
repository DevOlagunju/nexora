"use client";

import { useCallback, useEffect, useState } from "react";
import {
  formatCompactUsd,
  formatPriceUsd,
  formatSupply,
  type MarketRow,
} from "@/lib/markets";
import { formatClockTime } from "@/lib/format";

type MarketsResponse = {
  updatedAt: string;
  count: number;
  markets: MarketRow[];
  cached?: boolean;
};

function ChangeCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-soft">N/A</span>;
  const positive = value >= 0;
  return (
    <span className={positive ? "font-semibold text-emerald-600" : "font-semibold text-red-600"}>
      {positive ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

const POLL_MS = 60_000;

export function LiveMarketsTable({ initial }: { initial: MarketRow[] }) {
  const [markets, setMarkets] = useState(initial);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/markets", { cache: "no-store" });
      if (!res.ok) throw new Error("Feed failed");
      const data = (await res.json()) as MarketsResponse;
      if (!data.markets?.length) throw new Error("Empty feed");
      setMarkets(data.markets);
      setUpdatedAt(data.updatedAt);
      setLive(true);
      setError(null);
    } catch {
      setLive(false);
      setError("Reconnecting to live feed… last known data is shown.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);

    const id = window.setInterval(() => void refresh(true), POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_12px_40px_rgba(7,16,24,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-deep">
            Live market
          </p>
          <p className="text-sm text-ink-soft">
            {markets.length} matches
            {updatedAt ? ` · updated ${formatClockTime(updatedAt)}` : ""}
            {live ? " · live" : " · reconnecting"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(false)}
          disabled={loading}
          className="btn btn-ghost px-3 py-2 text-sm disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">{error}</p>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-[920px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[#fafbfc] text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              <th className="px-4 py-3">
                Name
                <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-ink-soft/80">
                  {markets.length} matches
                </span>
              </th>
              <th className="px-3 py-3 underline decoration-sky-500 decoration-2 underline-offset-8">
                Mkt Cap
              </th>
              <th className="px-3 py-3">FD Mkt Cap</th>
              <th className="px-3 py-3">Price</th>
              <th className="px-3 py-3">Avail Coins</th>
              <th className="px-3 py-3">Total Coins</th>
              <th className="px-3 py-3">Traded Vol</th>
              <th className="px-4 py-3 text-right">Chg %</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((coin) => (
              <tr
                key={coin.id}
                className="border-b border-[var(--line)] last:border-0 hover:bg-[#f7fafc]"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={coin.image}
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-full"
                    />
                    <div>
                      <a
                        href={`https://www.coingecko.com/en/coins/${coin.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-sky-600 hover:underline"
                      >
                        {coin.name}
                      </a>
                      <p className="text-xs uppercase text-ink-soft">{coin.symbol}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">{formatCompactUsd(coin.marketCap)}</td>
                <td className="px-3 py-3 tabular-nums text-ink">{formatCompactUsd(coin.fdv)}</td>
                <td className="px-3 py-3 tabular-nums font-medium text-ink">
                  {formatPriceUsd(coin.price)}
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">{formatSupply(coin.circulating)}</td>
                <td className="px-3 py-3 tabular-nums text-ink">{formatSupply(coin.totalSupply)}</td>
                <td className="px-3 py-3 tabular-nums text-ink">{formatCompactUsd(coin.volume)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <ChangeCell value={coin.change24h} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
