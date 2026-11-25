/** Pure helpers for rate alerts and desk transparency stats (unit tested). */

export function alertHit(direction: "ABOVE" | "BELOW", targetNgn: number, currentNgn: number) {
  return direction === "ABOVE" ? currentNgn >= targetNgn : currentNgn <= targetNgn;
}

/** Median of positive durations in minutes; null when there is no data. */
export function medianMinutes(durationsMs: number[]): number | null {
  const xs = durationsMs.filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  const ms = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return Math.max(1, Math.round(ms / 60_000));
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "-";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
