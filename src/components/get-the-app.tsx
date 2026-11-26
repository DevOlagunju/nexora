/**
 * Where customers get the Nexora app. Trading happens in the app; the website explains and links
 * here. Store links come from NEXT_PUBLIC_ANDROID_APP_URL / NEXT_PUBLIC_IOS_APP_URL; a store without a
 * link shows "Coming soon" rather than a link that goes nowhere.
 */

export function appLinks() {
  const clean = (v?: string) => (v && /^https:\/\//.test(v.trim()) ? v.trim() : null);
  return { android: clean(process.env.NEXT_PUBLIC_ANDROID_APP_URL), ios: clean(process.env.NEXT_PUBLIC_IOS_APP_URL) };
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
      <path d="M4.2 2.6 13.6 12l-9.4 9.4c-.3-.2-.5-.6-.5-1.1V3.7c0-.5.2-.9.5-1.1Z" fill="#34A853" />
      <path d="m16.8 8.8-3.2 3.2 3.2 3.2 3.7-2.1c.9-.5.9-1.7 0-2.2l-3.7-2.1Z" fill="#FBBC04" />
      <path d="M4.2 2.6c.3-.2.8-.3 1.3 0l11.3 6.2-3.2 3.2Z" fill="#4285F4" />
      <path d="M13.6 12l3.2 3.2-11.3 6.2c-.5.3-1 .2-1.3 0Z" fill="#EA4335" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
      <path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2.1-.9-3.4-.9-1.8 0-3.4 1-4.3 2.6-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 1.9 2.7 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.6-1-2.6-4.2ZM13.9 4.9c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5Z" />
    </svg>
  );
}

function StoreBadge({ href, store, icon }: { href: string | null; store: string; icon: React.ReactNode }) {
  const inner = (
    <>
      {icon}
      <span className="text-left leading-tight">
        <span className="block text-[11px] font-semibold opacity-80">{href ? "Get it on" : "Coming soon to"}</span>
        <span className="block text-lg font-bold">{store}</span>
      </span>
    </>
  );
  const cls = "inline-flex min-w-[11.5rem] items-center gap-3 rounded-2xl border px-4 py-2.5";
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${cls} border-white/20 bg-black text-white transition hover:-translate-y-0.5`}>
      {inner}
    </a>
  ) : (
    <span className={`${cls} cursor-default border-white/20 bg-black/40 text-white/80`} aria-label={`${store}: coming soon`}>
      {inner}
    </span>
  );
}

/** Store badges. On a dark background. */
export function StoreBadges() {
  const links = appLinks();
  return (
    <div className="flex flex-wrap gap-3">
      <StoreBadge href={links.android} store="Google Play" icon={<PlayIcon />} />
      <StoreBadge href={links.ios} store="App Store" icon={<AppleIcon />} />
    </div>
  );
}

/** The home page's download section (anchor #get-app). */
export function GetTheAppSection({ whatsapp }: { whatsapp?: string | null }) {
  const links = appLinks();
  const any = !!(links.android || links.ios);
  return (
    <section id="get-app" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-20">
      <div className="cta-panel overflow-hidden rounded-[2rem] bg-forest px-6 py-10 text-white md:px-10">
        <div className="grid gap-8 md:grid-cols-[1.2fr_0.8fr] md:items-center">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-accent-bright">Get the app</p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold md:text-4xl">Trade on the Nexora app</h2>
            <p className="mt-3 max-w-lg text-white/75">
              Sell crypto and gift cards, buy crypto, and withdraw Naira to your bank, all from your phone. Create your account
              and verify once in the app.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-white/80">
              <li>✓ Your rate is locked the moment you place an order</li>
              <li>✓ Your own deposit address, matched to your order automatically</li>
              <li>✓ Withdrawals need your PIN, and only go to your verified bank</li>
            </ul>
            <div className="mt-7">
              <StoreBadges />
            </div>
            {!any && whatsapp ? (
              <p className="mt-4 text-sm text-white/70">
                Launching soon.{" "}
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-bright underline">
                  Message us on WhatsApp
                </a>{" "}
                to be told the moment it&apos;s live.
              </p>
            ) : null}
          </div>
          <div className="hidden justify-center md:flex" aria-hidden="true">
            <div className="relative h-80 w-44 rounded-[2.2rem] border-[6px] border-black/80 bg-white shadow-2xl">
              <div className="absolute left-1/2 top-2 h-1.5 w-12 -translate-x-1/2 rounded-full bg-black/80" />
              <div className="m-3 mt-6 rounded-2xl bg-gradient-to-br from-[#0b5f31] via-[#0f8240] to-[#16a34a] p-3 text-white">
                <p className="text-[10px] opacity-80">Total Balance</p>
                <p className="text-lg font-black tracking-widest">₦ ••••••</p>
              </div>
              <div className="mx-3 grid grid-cols-4 gap-1.5">
                {["#e6f6ec", "#fff5d9", "#e6f6ec", "#e6f6ec"].map((c, i) => (
                  <div key={i} className="h-10 rounded-lg" style={{ background: c }} />
                ))}
              </div>
              <div className="mx-3 mt-3 h-16 rounded-xl bg-[#e6f6ec]" />
              <div className="mx-3 mt-3 space-y-1.5">
                <div className="h-2 w-3/4 rounded bg-[#e9f2ec]" />
                <div className="h-2 w-1/2 rounded bg-[#e9f2ec]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
