"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatNgn, formatClockTime } from "@/lib/format";

type NgnPayload = {
  market: {
    usdtNgn: number;
    btcNgn: number;
    ethNgn: number;
    fetchedAt: string;
  };
  desk: {
    USDT: { mid: number; sell: number; buy: number };
    BTC: { mid: number; sell: number; buy: number };
    ETH: { mid: number; sell: number; buy: number };
  };
};

export function UsdtNgnLiveCard({ initial }: { initial: NgnPayload | null }) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState(false);
  const prevSell = useRef(initial?.desk.USDT.sell);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ngn-rates", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as NgnPayload;
      if (prevSell.current != null && prevSell.current !== next.desk.USDT.sell) {
        setFlash(true);
        window.setTimeout(() => setFlash(false), 700);
      }
      prevSell.current = next.desk.USDT.sell;
      setData(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch at once only when the server could not supply a quote.
    const first = window.setTimeout(() => void refresh(), initial ? 30_000 : 0);
    const id = window.setInterval(() => {
      void refresh();
    }, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, initial]);

  if (!data) {
    return (
      <div className="card-panel text-sm text-ink-soft">
        Live rates unavailable right now. Please try again shortly.
      </div>
    );
  }

  const { market, desk } = data;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_12px_40px_rgba(7,16,24,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-[#fafbfc] px-4 py-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-deep">
            <span className="live-dot" aria-hidden />
            Live USDT rate
          </p>
          <p className="text-sm text-ink-soft">Updated {formatClockTime(market.fetchedAt)}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="btn btn-ghost px-3 py-2 text-sm disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className={`rounded-xl bg-emerald-50 p-4 ${flash ? "rate-flash" : ""}`}>
          <p className="text-xs uppercase tracking-wide text-accent-deep">Live market sell</p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold tabular-nums text-accent-deep">
            {formatNgn(desk.USDT.sell)}
          </p>
          <p className="mt-1 text-xs text-ink-soft">USDT / NGN reference. Your order uses the desk rate shown when you trade.</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-4">
          <p className="text-xs uppercase tracking-wide text-amber-800">Live market buy</p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold tabular-nums text-amber-900">
            {formatNgn(desk.USDT.buy)}
          </p>
          <p className="mt-1 text-xs text-ink-soft">USDT / NGN</p>
        </div>
      </div>
    </div>
  );
}
