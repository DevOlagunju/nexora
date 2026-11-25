import { listNotifications, markNotificationsRead, unreadNotificationCount } from "@/lib/services/notifications";
import { authed, data, pageSize } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/notifications?limit= */
export const GET = authed(async ({ user, query }) => {
  const [items, unread] = await Promise.all([listNotifications(user.id, pageSize(query, 50)), unreadNotificationCount(user.id)]);
  return data({ items, unread });
});

/** PATCH /api/v1/notifications  Marks every notification as read. */
export const PATCH = authed(async ({ user }) => data({ marked: await markNotificationsRead(user.id) }));
