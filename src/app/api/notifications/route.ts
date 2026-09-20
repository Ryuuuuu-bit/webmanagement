import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { countUnread, listNotifications } from "@/lib/notify";
import { getLocale } from "@/lib/i18n/locale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Polled by NotificationProvider (every ~30 s while the app is open, and on
 * returning to the tab) so the bell badge and the "new notification" toast
 * update without a page reload. Text is already rendered in the caller's
 * language — the client just displays it.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ unread: 0, items: [] }, { status: 401 });
  const locale = getLocale();
  const [unread, items] = await Promise.all([countUnread(session.user.id), listNotifications(session.user.id, locale, { limit: 15 })]);
  return NextResponse.json({ unread, items }, { headers: { "Cache-Control": "no-store" } });
}
