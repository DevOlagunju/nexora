import { NexoraLogo } from "@/components/nexora-logo";
import { ArrowRightIcon } from "@/components/landing/icons";

/**
 * Where customers get the Nexora app. Trading happens in the app; the website explains and links
 * here. Store links come from NEXT_PUBLIC_ANDROID_APP_URL / NEXT_PUBLIC_IOS_APP_URL; a store without a
 * link shows "Coming soon" rather than a link that goes nowhere.
 */

export function appLinks() {
  const clean = (v?: string) => (v && /^https:\/\//.test(v.trim()) ? v.trim() : null);
  return { android: clean(process.env.NEXT_PUBLIC_ANDROID_APP_URL), ios: clean(process.env.NEXT_PUBLIC_IOS_APP_URL) };
}

function PlayIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M4.2 2.6 13.6 12l-9.4 9.4c-.3-.2-.5-.6-.5-1.1V3.7c0-.5.2-.9.5-1.1Z" fill="#34A853" />
      <path d="m16.8 8.8-3.2 3.2 3.2 3.2 3.7-2.1c.9-.5.9-1.7 0-2.2l-3.7-2.1Z" fill="#FBBC04" />
      <path d="M4.2 2.6c.3-.2.8-.3 1.3 0l11.3 6.2-3.2 3.2Z" fill="#4285F4" />
      <path d="M13.6 12l3.2 3.2-11.3 6.2c-.5.3-1 .2-1.3 0Z" fill="#EA4335" />
    </svg>
  );
}

function AppleIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2.1-.9-3.4-.9-1.8 0-3.4 1-4.3 2.6-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 1.9 2.7 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.6-1-2.6-4.2ZM13.9 4.9c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5Z" />
    </svg>
  );
}

type BadgeSize = "lg" | "md";

function StoreBadge({ href, store, size }: { href: string | null; store: "Google Play" | "App Store"; size: BadgeSize }) {
  const lg = size === "lg";
  const icon = lg ? "h-9 w-9" : "h-7 w-7";
  const lead = href ? (store === "Google Play" ? "Get it on" : "Download on the") : "Coming soon to";
  const inner = (
    <>
      {store === "Google Play" ? <PlayIcon className={icon} /> : <AppleIcon className={icon} />}
      <span className="text-left leading-tight">
        <span className={`block font-medium ${lg ? "text-[13px]" : "text-[11px]"}`}>{lead}</span>
        <span className={`block font-semibold tracking-tight ${lg ? "text-[1.45rem]" : "text-lg"}`}>{store}</span>
      </span>
    </>
  );
  const cls = `store-badge ${lg ? "store-badge--lg" : ""}`;
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <span className={`${cls} cursor-default`} aria-label={`${store}: coming soon`}>
      {inner}
    </span>
  );
}

/** Google Play + App Store badges (black, as the stores require). */
export function StoreBadges({ size = "md" }: { size?: BadgeSize }) {
  const links = appLinks();
  return (
    <div className="flex flex-wrap gap-3.5">
      <StoreBadge href={links.android} store="Google Play" size={size} />
      <StoreBadge href={links.ios} store="App Store" size={size} />
    </div>
  );
}

/** The download banner at the foot of the home page (anchor #get-app). */
export function GetTheAppSection({ whatsapp }: { whatsapp?: string | null }) {
  const links = appLinks();
  const go = links.android ?? links.ios ?? whatsapp ?? null;
  const live = !!(links.android || links.ios);
  return (
    <section id="get-app" className="site-wrap scroll-mt-24 pb-14">
      <div className="download-banner relative overflow-hidden rounded-[1.75rem] text-white">
        <div className="relative grid items-center gap-6 px-6 py-8 md:grid-cols-[13rem_1fr_auto] md:py-0 lg:px-10">
          {/* Phone peeking up from the bottom edge. */}
          <div className="relative hidden h-36 md:block" aria-hidden="true">
            <div className="absolute -bottom-10 left-6 h-44 w-28 rotate-[-14deg] rounded-[1.6rem] border-[5px] border-[#111] bg-gradient-to-br from-[#0d7a3c] to-[#0a4f2a] shadow-2xl">
              <div className="mx-auto mt-1.5 h-1.5 w-9 rounded-full bg-[#111]" />
              <div className="mt-8 flex flex-col items-center">
                <NexoraLogo size={34} variant="white" />
                <span className="mt-1 text-xs font-bold">Nexora</span>
              </div>
            </div>
          </div>
          <div className="md:py-7">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold md:text-[1.7rem]">Download the Nexora App Today!</h2>
            <p className="mt-1.5 text-base text-white/85 md:text-lg">Start selling crypto and gift cards for Naira now.</p>
            {!live && whatsapp ? (
              <p className="mt-2 text-sm text-white/70">
                Launching soon.{" "}
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-bright underline">
                  Message us on WhatsApp
                </a>{" "}
                to be told the moment it&apos;s live.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-4 md:py-7">
            <StoreBadges />
            {go ? (
              <a
                href={go}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-accent-deep shadow-lg transition hover:translate-x-0.5"
                aria-label={live ? "Download the app" : "Message us on WhatsApp"}
              >
                <ArrowRightIcon className="h-6 w-6" />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
