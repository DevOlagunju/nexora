import { formatNgn } from "@/lib/format";
import { NexoraLogo } from "@/components/nexora-logo";
import { BellIcon, BuyIcon, EyeOffIcon, GiftIcon, SellIcon, WithdrawIcon } from "@/components/landing/icons";

export type PhoneAsset = { symbol: string; name: string; rateNgn: number; change24h: number | null };

const COIN: Record<string, { bg: string; glyph: string }> = {
  BTC: { bg: "#f7931a", glyph: "₿" },
  ETH: { bg: "#627eea", glyph: "Ξ" },
  USDT: { bg: "#26a17b", glyph: "₮" },
};

function Change({ value }: { value: number | null }) {
  if (value == null) return null;
  const flat = Math.abs(value) < 0.05;
  const color = flat ? "text-[var(--muted)]" : value > 0 ? "text-accent" : "text-danger";
  return (
    <span className={`text-[11px] font-semibold ${color}`}>
      {flat ? "0.0%" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`}
    </span>
  );
}

/**
 * The hero's phone: a sketch of the app's home screen. The balance stays hidden (there is no
 * customer here); the coins show the desk's real sell rates and the market's real 24h change.
 */
export function HeroPhone({ assets }: { assets: PhoneAsset[] }) {
  const actions = [
    { label: "Buy\nCrypto", Icon: BuyIcon },
    { label: "Sell\nCrypto", Icon: SellIcon },
    { label: "Gift\nCards", Icon: GiftIcon },
    { label: "Withdraw\nNaira", Icon: WithdrawIcon },
  ];
  return (
    <div className="hero-phone" aria-hidden="true">
      <div className="hero-phone-screen">
        <div className="mx-auto mt-2 h-6 w-24 rounded-full bg-[#111]" />
        <div className="mt-3 flex items-center justify-between px-5">
          <span className="flex items-center gap-1.5 font-[family-name:var(--font-display)] text-[17px] font-bold text-ink">
            <NexoraLogo size={22} /> Nexora
          </span>
          <BellIcon className="h-5 w-5 text-ink" />
        </div>

        <div className="mx-4 mt-4 rounded-2xl bg-gradient-to-br from-[#0b5f31] via-[#0f8240] to-[#16a34a] p-4 text-white shadow-[0_10px_24px_rgba(11,95,49,0.35)]">
          <div className="flex items-center justify-between text-[12px] text-white/85">
            Total Balance <EyeOffIcon className="h-4 w-4" />
          </div>
          <p className="mt-1 text-[24px] font-black tracking-[0.12em]">₦ ••••••</p>
          <p className="mt-1 text-[11px] text-white/75">Naira wallet</p>
        </div>

        <div className="mx-4 mt-4 grid grid-cols-4 gap-1 text-center">
          {actions.map(({ label, Icon }) => (
            <div key={label} className="flex flex-col items-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent-deep">
                <Icon className="h-5 w-5" />
              </span>
              <span className="mt-1 whitespace-pre-line text-[10px] font-medium leading-tight text-ink-soft">{label}</span>
            </div>
          ))}
        </div>

        <div className="mx-4 mt-4 flex items-center justify-between">
          <span className="text-[13px] font-bold text-ink">Today&apos;s rates</span>
          <span className="text-[11px] font-semibold text-accent-deep">See all →</span>
        </div>
        <ul className="mx-4 mt-1">
          {assets.map((a) => {
            const c = COIN[a.symbol] ?? { bg: "#12a150", glyph: a.symbol[0] };
            return (
              <li key={a.symbol} className="flex items-center gap-2.5 border-b border-[var(--line)] py-2.5 last:border-0">
                <span className="flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: c.bg }}>
                  {c.glyph}
                </span>
                <span className="flex-1 leading-tight">
                  <span className="block text-[13px] font-semibold text-ink">{a.name}</span>
                  <span className="block text-[10px] text-[var(--muted)]">{a.symbol} · we pay</span>
                </span>
                <span className="text-right leading-tight">
                  <span className="block text-[12.5px] font-bold text-ink tabular-nums">{formatNgn(a.rateNgn)}</span>
                  <Change value={a.change24h} />
                </span>
              </li>
            );
          })}
        </ul>

        <div className="absolute inset-x-0 bottom-0 flex justify-around border-t border-[var(--line)] bg-white px-3 pb-5 pt-2.5">
          {["Home", "Markets", "Trade", "Wallet", "Profile"].map((t, i) => (
            <span key={t} className={`flex flex-col items-center gap-1 text-[9.5px] font-medium ${i === 0 ? "text-accent" : "text-[var(--muted)]"}`}>
              <span className={`h-[18px] w-[18px] rounded-md ${i === 0 ? "bg-accent" : "bg-[#d5e3da]"}`} />
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
