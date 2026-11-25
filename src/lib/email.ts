import { randomBytes } from "crypto";
import { errorMessage, log } from "@/lib/log";

export function appBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; logged?: boolean }> {
  const emailKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.NOTIFY_FROM_EMAIL?.trim();

  if (!emailKey || !from) {
    // Body may contain a reset link: only print it outside production.
    if (process.env.NODE_ENV === "production") {
      log.warn("email: RESEND not configured, message dropped", { subject: input.subject });
    } else {
      console.info("[email] RESEND not configured - message logged only", {
        to: input.to,
        subject: input.subject,
        text: input.text,
      });
    }
    return { ok: true, logged: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${emailKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error("email: Resend error", { status: res.status, body: body.slice(0, 300) });
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    log.error("email: send failed", { error: errorMessage(err) });
    return { ok: false };
  }
}

export function newResetToken() {
  return randomBytes(32).toString("hex");
}
