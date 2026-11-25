import { formatNgnCompact } from "@/lib/format";

type Usage = { used: number; cap: number };

function tone(ratio: number) {
  if (ratio >= 0.9) return "danger";
  if (ratio >= 0.7) return "warn";
  return "ok";
}

function MeterRow({ label, usage, money = true }: { label: string; usage: Usage; money?: boolean }) {
  const ratio = usage.cap > 0 ? Math.min(1, usage.used / usage.cap) : 0;
  const fmt = (n: number) => (money ? formatNgnCompact(n) : String(n));
  const left = Math.max(0, usage.cap - usage.used);
  return (
    <li className="meter-row">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold text-ink">{label}</span>
        <span className="tabular-nums text-ink-soft">
          <span className="font-semibold text-ink">{fmt(usage.used)}</span> / {fmt(usage.cap)}
        </span>
      </div>
      <div
        className={`meter meter--${tone(ratio)}`}
        role="meter"
        aria-label={`${label} used today`}
        aria-valuemin={0}
        aria-valuemax={usage.cap}
        aria-valuenow={Math.round(usage.used)}
        aria-valuetext={`${fmt(usage.used)} of ${fmt(usage.cap)} used, ${fmt(left)} left`}
      >
        <span style={{ width: `${Math.max(ratio * 100, usage.used > 0 ? 2 : 0)}%` }} />
      </div>
    </li>
  );
}

/** Meter list of today's caps (reset at midnight Lagos time). */
export function LimitMeters({
  usage,
}: {
  usage: { cryptoSell: Usage; cryptoBuy: Usage; giftSell: Usage; orders: Usage };
}) {
  return (
    <ul className="space-y-3.5">
      <MeterRow label="Crypto sell" usage={usage.cryptoSell} />
      <MeterRow label="Crypto buy" usage={usage.cryptoBuy} />
      <MeterRow label="Gift card sell" usage={usage.giftSell} />
      <MeterRow label="Orders" usage={usage.orders} money={false} />
    </ul>
  );
}
