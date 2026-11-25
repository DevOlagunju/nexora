import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/security";
import { formatNgn } from "@/lib/format";
import { sendEmail, appBaseUrl } from "@/lib/email";
import { errorMessage, log } from "@/lib/log";
import { alertHit } from "@/lib/alert-rules";
import { pushNotification } from "@/lib/services/notifications";
import { fail, ok, TOO_MANY, type ServiceResult } from "@/lib/services/result";

const MAX_ACTIVE_PER_USER = 10;

const createSchema = z.object({
  rateId: z.string().min(1, "Pick an asset"),
  side: z.enum(["SELL", "BUY"]).default("SELL"),
  direction: z.enum(["ABOVE", "BELOW"]),
  targetNgn: z.coerce.number().positive("Enter a target rate").max(1e12),
});

export async function listRateAlerts(userId: string) {
  return prisma.rateAlert.findMany({
    where: { userId },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    take: 30,
  });
}

export async function createRateAlert(user: { id: string }, input: unknown): Promise<ServiceResult<null>> {
  if (!(await rateLimit(`alerts:${user.id}`, 20, 60_000))) return TOO_MANY();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid alert");
  const { rateId, side, direction, targetNgn } = parsed.data;

  const rate = await prisma.rate.findUnique({ where: { id: rateId } });
  if (!rate || !rate.isActive) return fail("That asset isn't available.");
  if (rate.kind === "GIFTCARD" && side === "BUY") return fail("Gift cards are sell-only.");

  const current = side === "SELL" ? rate.sellRateNgn : rate.buyRateNgn;
  if (alertHit(direction, targetNgn, current)) {
    return fail(
      `${rate.symbol} is already ${direction === "ABOVE" ? "at or above" : "at or below"} ${formatNgn(targetNgn)} (now ${formatNgn(current)}).`,
    );
  }
  const active = await prisma.rateAlert.count({ where: { userId: user.id, isActive: true } });
  if (active >= MAX_ACTIVE_PER_USER) return fail(`You can have up to ${MAX_ACTIVE_PER_USER} active alerts.`);

  await prisma.rateAlert.create({
    data: { userId: user.id, kind: rate.kind, symbol: rate.symbol, side, direction, targetNgn },
  });
  return ok(null, `We'll tell you when ${rate.symbol} ${side === "SELL" ? "sell" : "buy"} rate goes ${direction.toLowerCase()} ${formatNgn(targetNgn)}.`);
}

export async function deleteRateAlert(user: { id: string }, input: { id?: unknown }): Promise<ServiceResult<null>> {
  const { count } = await prisma.rateAlert.deleteMany({ where: { id: String(input.id ?? ""), userId: user.id } });
  return count ? ok(null, "Alert removed.") : fail("Alert not found.", 404);
}

/** Fire every alert the current desk rates satisfy. Called after manual rate saves and market sync. */
export async function checkRateAlerts(): Promise<number> {
  try {
    const [rates, alerts] = await Promise.all([
      prisma.rate.findMany({ where: { isActive: true } }),
      prisma.rateAlert.findMany({
        where: { isActive: true },
        include: { user: { select: { email: true } } },
        take: 2000,
      }),
    ]);
    const byKey = new Map(rates.map((r) => [`${r.kind}:${r.symbol}`, r]));
    let fired = 0;
    for (const a of alerts) {
      const rate = byKey.get(`${a.kind}:${a.symbol}`);
      if (!rate) continue;
      const current = a.side === "SELL" ? rate.sellRateNgn : rate.buyRateNgn;
      if (!alertHit(a.direction, a.targetNgn, current)) continue;

      // Conditional update: only the first checker to flip it sends the notification.
      const { count } = await prisma.rateAlert.updateMany({
        where: { id: a.id, isActive: true },
        data: { isActive: false, triggeredAt: new Date() },
      });
      if (count === 0) continue;
      fired++;
      const verb = a.side === "SELL" ? "sell" : "buy";
      const title = `${rate.symbol} ${verb} rate is ${formatNgn(current)}`;
      const body = `Your alert for ${a.direction === "ABOVE" ? "above" : "below"} ${formatNgn(a.targetNgn)} was hit. Rates move fast, so lock it in by placing an order.`;
      const href = a.kind === "GIFTCARD" ? "/dashboard/sell-giftcard" : a.side === "SELL" ? "/dashboard/sell-crypto" : "/dashboard/buy-crypto";
      await pushNotification(a.userId, { title, body, href });
      void sendEmail({ to: a.user.email, subject: `Nexora rate alert: ${title}`, text: `${body}\n\n${appBaseUrl()}${href}` });
    }
    return fired;
  } catch (err) {
    log.error("rate-alerts: check failed", { error: errorMessage(err) });
    return 0;
  }
}
