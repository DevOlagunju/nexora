"use client";

import { useId, useState } from "react";

/**
 * Smooth path through points (Catmull-Rom turned into cubic Béziers). Control points are kept
 * between the two points they join, so the curve never overshoots: no dips below zero, no peaks
 * above the real value.
 */
function smoothPath(points: [number, number][]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
  const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b));
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6, p1[1], p2[1]);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6, p1[1], p2[1]);
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function scale(values: number[], w: number, h: number, pad = 4, maxOverride?: number) {
  const max = maxOverride ?? Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => [i * step, pad + (h - pad * 2) * (1 - (v - min) / span)] as [number, number]);
}

/** Small trend line with a soft fill, for KPI cards. Flat when there is no data. */
export function Sparkline({ values, className = "h-14 w-full" }: { values: number[]; className?: string }) {
  const id = useId().replace(/:/g, "");
  const w = 200;
  const h = 56;
  const pts = scale(values.length ? values : [0, 0], w, h);
  const line = smoothPath(pts);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#s${id})`} />
      <path d={line} fill="none" stroke="var(--accent-deep)" strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const ngnAxis = (v: number) =>
  v >= 1e9 ? `${Number((v / 1e9).toFixed(1))}B` : v >= 1e6 ? `${Number((v / 1e6).toFixed(1))}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : `${Math.round(v)}`;

/**
 * Trade volume (₦, left axis) and new customers (right, scaled to fit) over the chosen period.
 * Hover or tap a point to read both values for that day or week.
 */
export function PerformanceChart({ labels, volume, signups }: { labels: string[]; volume: number[]; signups: number[] }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = 340;
  const left = 62;
  const bottom = 26;
  const plotW = W - left - 8;
  const plotH = H - bottom - 8;
  const rawMax = Math.max(...volume, 0);
  // A tidy top for the axis: 1, 2 or 5 times a power of ten.
  const mag = 10 ** Math.floor(Math.log10(rawMax || 1));
  const top = rawMax === 0 ? 1 : ([1, 2, 5, 10].map((m) => m * mag).find((t) => t >= rawMax) ?? 10 * mag);
  const userMax = Math.max(...signups, 1);
  const n = labels.length;
  const x = (i: number) => left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yVol = (v: number) => 8 + plotH * (1 - v / top);
  // New customers drawn on their own scale, in the lower ~70% of the plot so the lines rarely cross.
  const yUsers = (v: number) => 8 + plotH * (1 - (v / userMax) * 0.7);
  const volPts = volume.map((v, i) => [x(i), yVol(v)] as [number, number]);
  const userPts = signups.map((v, i) => [x(i), yUsers(v)] as [number, number]);
  const volLine = smoothPath(volPts);
  const userLine = smoothPath(userPts);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top * f);
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const h = hover;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Trade volume and new customers over the period"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - left) / plotW) * (n - 1));
          setHover(i >= 0 && i < n ? i : null);
        }}
      >
        <defs>
          <linearGradient id={`v${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - 8} y1={yVol(t)} y2={yVol(t)} stroke="rgba(15,27,20,0.07)" />
            <text x={left - 10} y={yVol(t) + 4} textAnchor="end" fontSize="15" fill="var(--muted)">
              {ngnAxis(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize="15" fill="var(--muted)">
              {l}
            </text>
          ) : null,
        )}
        <path d={`${volLine} L${x(n - 1)},${8 + plotH} L${x(0)},${8 + plotH} Z`} fill={`url(#v${id})`} />
        <path d={userLine} fill="none" stroke="#5be38f" strokeWidth={3} strokeLinecap="round" />
        <path d={volLine} fill="none" stroke="var(--accent-deep)" strokeWidth={3} strokeLinecap="round" />
        {h !== null ? (
          <g>
            <line x1={x(h)} x2={x(h)} y1={8} y2={8 + plotH} stroke="rgba(15,27,20,0.2)" strokeDasharray="4 4" />
            <circle cx={x(h)} cy={yVol(volume[h])} r={6} fill="#fff" stroke="var(--accent-deep)" strokeWidth={3} />
            <circle cx={x(h)} cy={yUsers(signups[h])} r={6} fill="#fff" stroke="#3fcf7a" strokeWidth={3} />
          </g>
        ) : null}
      </svg>
      {h !== null ? (
        <div
          className="pointer-events-none absolute top-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: `calc(${(x(h) / W) * 100}% ${h > n * 0.7 ? "- 10.5rem" : "+ 0.75rem"})` }}
        >
          <p className="font-bold text-ink">{labels[h]}</p>
          <p className="mt-1 text-accent-deep">
            ● Volume: <strong>₦{volume[h].toLocaleString("en-NG", { maximumFractionDigits: 0 })}</strong>
          </p>
          <p className="text-[#2fae63]">
            ● New customers: <strong>{signups[h]}</strong>
          </p>
        </div>
      ) : null}
    </div>
  );
}
