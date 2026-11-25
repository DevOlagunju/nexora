import "server-only";
import { prisma } from "@/lib/db";
import { errorMessage, log } from "@/lib/log";

/** In-app notification feed (bell + /dashboard/notifications + mobile). Never throws. */
export async function pushNotification(userId: string, input: { title: string; body: string; href?: string }) {
  try {
    await prisma.notification.create({
      data: { userId, title: input.title.slice(0, 120), body: input.body.slice(0, 500), href: input.href ?? null },
    });
  } catch (err) {
    log.warn("notification: write failed", { userId, error: errorMessage(err) });
  }
}

export function unreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export function listNotifications(userId: string, take = 30) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, title: true, body: true, href: true, readAt: true, createdAt: true },
  });
}

export async function markNotificationsRead(userId: string) {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return count;
}
