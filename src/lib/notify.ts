/** Fire-and-forget admin alerts (Slack/Discord/WhatsApp webhook URL). */
export async function notifyAdmin(event: string, payload: Record<string, unknown>) {
  const url = process.env.ADMIN_WEBHOOK_URL;
  const body = {
    text: `[Nexora] ${event}`,
    event,
    payload,
    at: new Date().toISOString(),
  };

  console.info("[notify]", event, payload);

  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[notify] webhook failed", err);
  }
}
