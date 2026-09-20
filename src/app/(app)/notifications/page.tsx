import { requireUser } from "@/lib/session";
import { listNotifications } from "@/lib/notify";
import { getLocale } from "@/lib/i18n/locale";
import NotificationList from "@/components/NotificationList";

export const dynamic = "force-dynamic";

/**
 * Full notification list. Opening it marks everything read (the badge
 * clears) while the rows that *were* unread stay highlighted so the reader
 * can still see what's new — see NotificationList.
 */
export default async function NotificationsPage() {
  const session = await requireUser();
  const items = await listNotifications(session.user.id, getLocale(), { limit: 50 });
  return <NotificationList initialItems={items} />;
}
