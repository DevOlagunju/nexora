/** Line icons for the public website (24px grid, stroke = currentColor). */

type P = { className?: string };

function Svg({ className = "h-6 w-6", children, fill = false }: P & { children: React.ReactNode; fill?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ShieldCheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.4 7.5 9.5 4.4-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
    <path d="m8.8 12 2.2 2.2 4.3-4.4" />
  </Svg>
);

/** Solid shield with a white tick, like the mockup's badges. */
export const ShieldSolidIcon = ({ className = "h-6 w-6" }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path d="M12 2.5 4 5.7v5.8c0 4.9 3.3 9 8 10.1 4.7-1.1 8-5.2 8-10.1V5.7l-8-3.2Z" fill="currentColor" />
    <path d="m8.6 12 2.4 2.4 4.5-4.6" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const CheckCircleIcon = ({ className = "h-5 w-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="currentColor" opacity={0.15} />
    <path d="m7.8 12.3 2.8 2.8 5.6-5.7" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const BoltIcon =(p: P) => (
  <Svg {...p} fill>
    <path d="M13.4 2 4.8 13.1c-.4.5 0 1.2.6 1.2h5.1l-1.4 7.1c-.1.6.6.9 1 .4l8.6-11.1c.4-.5 0-1.2-.6-1.2h-5.1l1.4-7.1c.1-.6-.6-.9-1-.4Z" />
  </Svg>
);

export const HeadsetIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <rect x="3" y="13.5" width="4" height="6" rx="1.6" />
    <rect x="17" y="13.5" width="4" height="6" rx="1.6" />
    <path d="M19 19.5c0 1.4-1.6 2.5-4 2.5h-1.5" />
  </Svg>
);

export const BankIcon = (p: P) => (
  <Svg {...p}>
    <path d="m3 9 9-5 9 5" />
    <path d="M4.5 9.5h15" />
    <path d="M6 10v7M10 10v7M14 10v7M18 10v7" />
    <path d="M3.5 20.5h17" />
  </Svg>
);

export const GiftIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="8" width="17" height="4" rx="1" />
    <path d="M5 12v8.5h14V12M12 8v12.5" />
    <path d="M12 8C10.5 4.5 7 4.3 7 6.3 7 7.6 9 8 12 8Zm0 0c1.5-3.5 5-3.7 5-1.7C17 7.6 15 8 12 8Z" />
  </Svg>
);

export const RocketIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 4.5c2.4-1.2 4.7-1.4 5.5-.5.9.8.7 3.1-.5 5.5L13 16l-5-5 6.5-6.5Z" />
    <path d="M8 11 5 10.5 3.5 13l4 1M13 16l.5 3 2.5-1.5-1-4" />
    <path d="M7.5 16.5c-1.5.3-2.8 1.6-3 3.5 1.9-.2 3.2-1.5 3.5-3" />
    <circle cx="15.5" cy="8.5" r="1.4" />
  </Svg>
);

export const TagIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 12.6V5a1.5 1.5 0 0 1 1.5-1.5h7.6l8 8a1.5 1.5 0 0 1 0 2.1l-7 7a1.5 1.5 0 0 1-2.1 0l-8-8Z" />
    <circle cx="8.2" cy="8.2" r="1.5" />
  </Svg>
);

export const LockIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <path d="M12 14.5v2.5" />
  </Svg>
);

export const ArrowRightIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const DownloadIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
  </Svg>
);

export const ChevronDownIcon = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const MenuIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const BellIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5l1.5-2Z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Svg>
);

export const EyeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 12c1-2.4 4.5-7 9.5-7s8.5 4.6 9.5 7c-1 2.4-4.5 7-9.5 7s-8.5-4.6-9.5-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const EyeOffIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c5 0 8.5 4.6 9.5 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.6 7.9 3.1 10 2.5 12c1 2.4 4.5 7 9.5 7 1.7 0 3.2-.5 4.5-1.3" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Svg>
);

export const WhatsAppIcon = ({ className = "h-6 w-6" }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
    <path d="M12 2.2A9.8 9.8 0 0 0 3.6 17l-1.4 4.8 4.9-1.3A9.8 9.8 0 1 0 12 2.2Zm0 17.9c-1.5 0-3-.4-4.2-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8.1 8.1 0 1 1 12 20.1Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.6 1.1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
  </svg>
);

export const BuyIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="14" rx="3" />
    <path d="M12 9v6M9 12h6" />
  </Svg>
);

export const SellIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="14" rx="3" />
    <path d="M9 12h6" />
  </Svg>
);

export const WithdrawIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v10M8 10l4 4 4-4" />
    <path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </Svg>
);
