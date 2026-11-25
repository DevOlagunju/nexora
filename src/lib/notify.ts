import { errorMessage, log } from "@/lib/log";

/** Fire-and-forget admin alerts (Slack/Discord/WhatsApp webhook URL). */
export async function notifyAdmin(event: string, payload: Record<string, unknown>) {
  const url = process.env.ADMIN_WEBHOOK_URL;
  const body = {
    text: `[Nexora] ${event}`,
    event,
    payload,
    at: new Date().toISOString(),
  };

  log.info(`notify: ${event}`, payload);

  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    log.error("notify: webhook failed", { event, error: errorMessage(err) });
  }
}
