import { statusLabel, statusPillClass } from "@/lib/status-ui";

export function StatusPill({ status }: { status: string }) {
  return <span className={statusPillClass(status)}>{statusLabel(status)}</span>;
}
