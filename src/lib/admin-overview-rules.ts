/**
 * Pure helpers for the admin overview: date ranges, chart buckets in Lagos time, and the
 * percentage maths. Unit tested in tests/admin-overview-rules.test.ts.
 */

export const OVERVIEW_RANGES = {
  "7d": { days: 7, label: "Last 7 days", short: "7D" },
  "30d": { days: 30, label: "Last 30 days", short: "30D" },
  "90d": { days: 90, label: "Last 90 days", short: "90D" },
  "1y": { days: 365, label: "Last 12 months", short: "1Y" },
} as const;

export type OverviewRange = keyof typeof OVERVIEW_RANGES;

export function parseRange(value: unknown): OverviewRange {
  return typeof value === "string" && value in OVERVIEW_RANGES ? (value as OverviewRange) : "30d";
}

const DAY = 24 * 3_600_000;
/** Lagos is UTC+1 all year. */
const LAGOS_OFFSET = 3_600_000;

/** Midnight in Lagos at or before `t`, as a UTC Date. */
export function lagosMidnight(t: Date): Date {
  const shifted = t.getTime() + LAGOS_OFFSET;
  return new Date(shifted - (shifted % DAY) - LAGOS_OFFSET);
}

export type Bucket = { start: Date; end: Date; label: string };

/**
 * Chart buckets ending now: one per Lagos day, or one per week for a year (52 points read better
 * than 365). The first bucket starts at the beginning of the period.
 */
export function buckets(range: OverviewRange, now = new Date()): Bucket[] {
  const { days } = OVERVIEW_RANGES[range];
  const step = range === "1y" ? 7 : 1;
  const count = Math.ceil(days / step);
  const todayStart = lagosMidnight(now);
  const out: Bucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(todayStart.getTime() - (i * step + (step - 1)) * DAY);
    const end = i === 0 ? now : new Date(start.getTime() + step * DAY);
    out.push({ start, end, label: start.toLocaleDateString("en-NG", { month: "short", day: "numeric", timeZone: "Africa/Lagos" }) });
  }
  return out;
}

/** Index of the bucket a moment falls in, or -1 outside them. Buckets are in time order. */
export function bucketIndex(list: Bucket[], t: Date): number {
  const ms = t.getTime();
  if (list.length === 0 || ms < list[0].start.getTime() || ms > list[list.length - 1].end.getTime()) return -1;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].start.getTime() <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Percentage change from `before` to `after`; null when there is nothing to compare with. */
export function pctChange(after: number, before: number): number | null {
  if (!Number.isFinite(after) || !Number.isFinite(before) || before === 0) return null;
  return ((after - before) / Math.abs(before)) * 100;
}

/** Completed trades as a share of all trades that reached an end state; null with none. */
export function successRate(completed: number, failed: number): number | null {
  const finished = completed + failed;
  return finished === 0 ? null : (completed / finished) * 100;
}

/** "12.5%", "-3.1%", "0%". */
export function formatPct(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded === 0 ? 0 : rounded}%`;
}

/** ₦18.7B, ₦724.8M, ₦12.4K, ₦950. */
export function compactNgn(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const fmt = (n: number, unit: string) => `${sign}₦${Number(n.toFixed(1))}${unit}`;
  if (abs >= 1e9) return fmt(abs / 1e9, "B");
  if (abs >= 1e6) return fmt(abs / 1e6, "M");
  if (abs >= 1e4) return fmt(abs / 1e3, "K");
  return `${sign}₦${Math.round(abs).toLocaleString("en-NG")}`;
}

/** "2m ago", "3h ago", "5d ago". */
export function ago(t: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - t.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * The bell remembers which waiting items this staff member has already seen (stored in the
 * browser as a JSON list of ids). Anything unreadable counts as "seen nothing".
 */
export function parseSeen(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const list: unknown = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/** Waiting items not seen yet: what the bell's badge counts. */
export function unseenIds(ids: readonly string[], seen: ReadonlySet<string>): string[] {
  return ids.filter((id) => !seen.has(id));
}
