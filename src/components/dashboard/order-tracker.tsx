import type { ActivityItem } from "@/lib/dashboard";
import { Check } from "@/components/dashboard/icons";

type Step = { status: string; label: string };

const FLOWS: Record<ActivityItem["kind"], Step[]> = {
  "crypto-sell": [
    { status: "AWAITING_DEPOSIT", label: "Send crypto" },
    { status: "UNDER_REVIEW", label: "Desk verifies" },
    { status: "APPROVED", label: "Approved" },
    { status: "PAYOUT_SENT", label: "Naira sent" },
    { status: "COMPLETED", label: "Done" },
  ],
  "crypto-buy": [
    { status: "AWAITING_DEPOSIT", label: "Pay Naira" },
    { status: "UNDER_REVIEW", label: "Desk confirms" },
    { status: "APPROVED", label: "Approved" },
    { status: "PAYOUT_SENT", label: "Crypto sent" },
    { status: "COMPLETED", label: "Done" },
  ],
  gift: [
    { status: "UNDER_REVIEW", label: "Card review" },
    { status: "APPROVED", label: "Approved" },
    { status: "PAYOUT_SENT", label: "Naira sent" },
    { status: "COMPLETED", label: "Done" },
  ],
};

/** Horizontal lifecycle tracker: done steps checked, current step pulsing. */
export function OrderTracker({ kind, status }: { kind: ActivityItem["kind"]; status: string }) {
  const steps = FLOWS[kind];
  const current = Math.max(0, steps.findIndex((s) => s.status === status));
  const pct = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0;

  return (
    <div className="tracker" style={{ ["--tracker-steps" as string]: steps.length }}>
      <div className="tracker-rail" aria-hidden>
        <div className="tracker-fill" style={{ width: `${pct}%` }} />
      </div>
      <ol className="tracker-steps">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li key={s.status} className={`tracker-step tracker-step--${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="tracker-dot">{state === "done" ? <Check className="h-3 w-3" /> : null}</span>
              <span className="tracker-label">{s.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
