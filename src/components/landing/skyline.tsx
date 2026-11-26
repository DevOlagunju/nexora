/**
 * Decorative city skyline for the home hero: green-tinted towers, a cable-stayed bridge and a
 * band of trees. Purely illustrative (aria-hidden).
 */

type Tower = { x: number; w: number; h: number; tone: number; roof?: "spire" | "slant" | "flat" };

const BASE = 330;
const TONES = ["#a9cdb8", "#8fbfa3", "#c4dfcf", "#7fb294", "#b6d6c3"];

const TOWERS: Tower[] = [
  { x: 20, w: 34, h: 150, tone: 2 },
  { x: 58, w: 26, h: 205, tone: 0, roof: "spire" },
  { x: 88, w: 40, h: 120, tone: 4 },
  { x: 150, w: 30, h: 175, tone: 1, roof: "slant" },
  { x: 184, w: 22, h: 110, tone: 2 },
  { x: 470, w: 36, h: 140, tone: 4 },
  { x: 510, w: 30, h: 240, tone: 1, roof: "spire" },
  { x: 544, w: 42, h: 185, tone: 0, roof: "slant" },
  { x: 590, w: 28, h: 125, tone: 2 },
  { x: 622, w: 38, h: 205, tone: 3 },
  { x: 664, w: 24, h: 150, tone: 4 },
  { x: 692, w: 34, h: 110, tone: 2 },
];

function windows(t: Tower) {
  const rows: React.ReactNode[] = [];
  const top = BASE - t.h + 16;
  for (let y = top; y < BASE - 14; y += 13) {
    for (let x = t.x + 5; x < t.x + t.w - 6; x += 8) {
      rows.push(<rect key={`${x}-${y}`} x={x} y={y} width={4} height={6} rx={0.6} fill="#ffffff" opacity={0.55} />);
    }
  }
  return rows;
}

function roof(t: Tower) {
  const top = BASE - t.h;
  if (t.roof === "spire") {
    return (
      <>
        <path d={`M${t.x + 3} ${top} L${t.x + t.w / 2} ${top - 22} L${t.x + t.w - 3} ${top} Z`} fill={TONES[t.tone]} />
        <rect x={t.x + t.w / 2 - 1} y={top - 44} width={2} height={24} fill={TONES[t.tone]} />
      </>
    );
  }
  if (t.roof === "slant") return <path d={`M${t.x} ${top} L${t.x + t.w} ${top - 18} L${t.x + t.w} ${top} Z`} fill={TONES[t.tone]} />;
  return null;
}

function trees(from: number, to: number, seed: number) {
  const out: React.ReactNode[] = [];
  const greens = ["#2f9e55", "#3fb065", "#23874a", "#56c27a", "#1d7440"];
  let i = seed;
  for (let x = from; x < to; x += 15) {
    i = (i * 9301 + 49297) % 233280;
    const r = 13 + (i % 9);
    out.push(<circle key={x} cx={x} cy={BASE - 4 - (i % 7)} r={r} fill={greens[i % greens.length]} />);
  }
  return out;
}

/** The broad green sweep in the hero's top-right corner, with a light edge curving past the phone. */
export function HeroSweep({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 800 760" className={className} preserveAspectRatio="xMaxYMin slice" aria-hidden="true">
      <defs>
        <linearGradient id="sweep-fill" x1="0.2" y1="0" x2="1" y2="0.9">
          <stop offset="0" stopColor="#12a150" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#3cc674" stopOpacity="0.75" />
          <stop offset="1" stopColor="#9ff0bf" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="sweep-edge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M800 0 H360 C250 170 290 430 520 560 C610 612 710 640 800 650 Z" fill="url(#sweep-fill)" />
      <path d="M800 0 H470 C390 160 420 380 600 480 C670 520 740 540 800 548 Z" fill="#0b7a3b" opacity="0.35" />
      <path d="M352 0 C240 175 285 440 520 568 C612 620 712 648 800 658" fill="none" stroke="url(#sweep-edge)" strokeWidth="5" />
    </svg>
  );
}

export function Skyline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 900 360" className={className} preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      {TOWERS.map((t) => (
        <g key={t.x}>
          {roof(t)}
          <rect x={t.x} y={BASE - t.h} width={t.w} height={t.h} fill={TONES[t.tone]} />
          {windows(t)}
        </g>
      ))}

      {/* Cable-stayed bridge: one pylon, fanned cables, low deck. */}
      <g stroke="#9cc4ad" fill="none" strokeLinecap="round">
        <path d="M815 330 L828 92 L841 330" strokeWidth={9} />
        <path d="M818 190 L838 190" strokeWidth={6} />
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <g key={k} strokeWidth={1.6}>
            <path d={`M828 ${104 + k * 10} L${740 - k * 22} 300`} />
            <path d={`M828 ${104 + k * 10} L${905 + k * 20} 300`} />
          </g>
        ))}
        <path d="M700 300 L900 300" strokeWidth={6} />
      </g>

      {trees(0, 250, 7)}
      {trees(440, 900, 3)}
    </svg>
  );
}
