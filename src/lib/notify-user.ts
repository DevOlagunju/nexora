/**
 * User-facing notifications (email today; push later).
 */

import { notifyAdmin } from "@/lib/notify";
import { appBaseUrl, sendEmail } from "@/lib/email";
import { STATUS_LABEL } from "@/lib/order-status";
import { log } from "@/lib/log";
import { formatNgn } from "@/lib/format";
import { pushNotification } from "@/lib/services/notifications";

const STATUS_HINT: Record<string, string> = {
  UNDER_REVIEW: "Our desk is verifying it now.",
  APPROVED: "It passed verification. Your payout is being prepared.",
  PAYOUT_SENT: "Your payout has been sent. Bank settlement can take a few minutes.",
  COMPLETED: "This order is complete. Thank you for trading with Nexora.",
  REJECTED: "It could not be completed. Contact support if you need help.",
  CANCELLED: "This order was cancelled.",
};

export async function notifyOrderStatus(input: {
  userId: string;
  email?: string;
  reference: string;
  status: string;
  channel: "crypto" | "gift";
  note?: string;
  /** Set when completion credited the Naira wallet instead of a bank transfer. */
  walletCredited?: number;
}) {
  const label = STATUS_LABEL[input.status] ?? input.status;
  const hint = input.walletCredited
    ? `${formatNgn(input.walletCredited)} is now in your Nexora wallet. Withdraw to your bank any time.`
    : (STATUS_HINT[input.status] ?? "");

  await pushNotification(input.userId, {
    title: input.walletCredited ? `${formatNgn(input.walletCredited)} added to your wallet` : `Order ${label.toLowerCase()}`,
    body: [`${input.reference}: ${hint}`, input.note ? `Desk note: ${input.note}` : ""].filter(Boolean).join(" "),
    href: input.walletCredited ? "/dashboard/wallet" : "/dashboard/orders",
  });
  log.info("notify-user: order status", {
    userId: input.userId,
    reference: input.reference,
    status: input.status,
    channel: input.channel,
  });

  if (input.email) {
    const lines = [
      `Your Nexora ${input.channel === "gift" ? "gift card" : "crypto"} order ${input.reference} is now: ${label}.`,
      hint,
      input.note ? `Desk note: ${input.note}` : "",
      "",
      `Track it at ${appBaseUrl()}/dashboard/orders`,
    ].filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""));
    await sendEmail({
      to: input.email,
      subject: `Nexora order ${input.reference}: ${label}`,
      text: lines.join("\n"),
    });
  }

  void notifyAdmin("order.status_user_notify", {
    userId: input.userId,
    reference: input.reference,
    status: input.status,
    channel: input.channel,
  });
}
