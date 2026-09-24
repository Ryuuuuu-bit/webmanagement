"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_PER_USER_PAGE } from "@/lib/notify";

/** Marks one of the caller's own notifications read (no-op for anyone else's). */
export async function markNotificationRead(id: string): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return;
  await prisma.notification.updateMany({ where: { id, userId: session.user.id, readAt: null }, data: { readAt: new Date() } });
}

/**
 * Marks everything the caller can actually SEE as read — used when the
 * notifications page opens. Scoped to the same MAX_PER_USER_PAGE window the
 * page itself fetches (see listNotifications): an unbounded updateMany here
 * would silently mark older unread notifications the user never had a
 * chance to see, so the unread badge would undercount without anything
 * having actually been read.
 */
export async function markAllNotificationsRead(): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return;
  const visible = await prisma.notification.findMany({
    where: { userId: session.user.id, readAt: null },
    orderBy: { createdAt: "desc" },
    take: MAX_PER_USER_PAGE,
    select: { id: true },
  });
  if (visible.length === 0) return;
  await prisma.notification.updateMany({ where: { id: { in: visible.map((n) => n.id) } }, data: { readAt: new Date() } });
}
