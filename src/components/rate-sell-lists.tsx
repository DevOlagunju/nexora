import { formatNgn } from "@/lib/format";

export type RateListItem = {
  id: string;
  symbol: string;
  displayName: string;
  sellRateNgn: number;
  buyRateNgn?: number;
};

function cryptoLabel(displayName: string) {
  return displayName.replace(/\s*\(.*\)$/, "");
}

function giftLabel(symbol: string, displayName: string) {
  if (symbol === "GOOGLE") return "Google Play";
  return displayName.replace(/ Gift Card$/i, "");
}

export function RateSellLists({
  cryptoRates,
  giftRates,
  showBuy = false,
}: {
  cryptoRates: RateListItem[];
  giftRates: RateListItem[];
  /** When true, show a compact crypto buy section under sell (rates page). */
  showBuy?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white/90 p-5">
      <div>
        <div className="flex items-end justify-between gap-3 border-b border-[var(--line)] pb-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink">
            Crypto sell
          </h3>
          <span className="text-[11px] font-medium text-[var(--muted)]">NGN / unit</span>
        </div>
        <ul className="mt-1">
          {cryptoRates.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-3 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold tracking-tight text-ink">
                  {r.symbol}
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                  {cryptoLabel(r.displayName)}
                </span>
              </span>
              <span className="shrink-0 text-right text-[15px] font-bold tabular-nums tracking-tight text-accent-deep">
                {formatNgn(r.sellRateNgn)}
              </span>
            </li>
          ))}
          {cryptoRates.length === 0 && (
            <li className="py-3 text-sm text-ink-soft">No crypto rates active.</li>
          )}
        </ul>
      </div>

      {showBuy && (
        <div className="mt-6 border-t border-[var(--line)] pt-5">
          <div className="flex items-end justify-between gap-3 border-b border-[var(--line)] pb-3">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink">
              Crypto buy
            </h3>
            <span className="text-[11px] font-medium text-[var(--muted)]">NGN / unit</span>
          </div>
          <ul className="mt-1">
            {cryptoRates.map((r) => (
              <li
                key={`buy-${r.id}`}
                className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-3 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold tracking-tight text-ink">
                    {r.symbol}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[var(--muted)]">
                    {cryptoLabel(r.displayName)}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[15px] font-bold tabular-nums tracking-tight text-ink">
                  {formatNgn(r.buyRateNgn ?? 0)}
                </span>
              </li>
            ))}
            {cryptoRates.length === 0 && (
              <li className="py-3 text-sm text-ink-soft">No crypto rates active.</li>
            )}
          </ul>
        </div>
      )}

      <div className="mt-6 border-t border-[var(--line)] pt-5">
        <div className="flex items-end justify-between gap-3 border-b border-[var(--line)] pb-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink">
            Gift cards
          </h3>
          <span className="text-[11px] font-medium text-[var(--muted)]">NGN per $1</span>
        </div>
        <ul className="mt-1">
          {giftRates.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-3 last:border-b-0"
            >
              <span className="min-w-0 text-[15px] font-semibold tracking-tight text-ink">
                {giftLabel(r.symbol, r.displayName)}
              </span>
              <span className="shrink-0 text-right text-[15px] font-bold tabular-nums tracking-tight text-accent-deep">
                {formatNgn(r.sellRateNgn)}
              </span>
            </li>
          ))}
          {giftRates.length === 0 && (
            <li className="py-3 text-sm text-ink-soft">No gift card rates active.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
