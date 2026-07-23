/**
 * User-facing notifications (email / push later).
 * Today: logs + optional ADMIN_WEBHOOK forwarding for status changes.
 */

import { notifyAdmin } from "@/lib/notify";
import { sendEmail } from "@/lib/email";

export async function notifyOrderStatus(input: {
  userId: string;
  email?: string;
  reference: string;
  status: string;
  channel: "crypto" | "gift";
}) {
  const payload = {
    userId: input.userId,
    email: input.email,
    reference: input.reference,
    status: input.status,
    channel: input.channel,
  };

  console.info("[notify-user]", payload);

  if (input.email) {
    await sendEmail({
      to: input.email,
      subject: `Nexora order ${input.reference}: ${input.status}`,
      text: `Your Nexora ${input.channel} order ${input.reference} is now ${input.status}.`,
    });
  }

  void notifyAdmin("order.status_user_notify", payload);
}
