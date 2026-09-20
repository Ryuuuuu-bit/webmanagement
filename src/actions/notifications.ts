"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Marks one of the caller's own notifications read (no-op for anyone else's). */
export async function markNotificationRead(id: string): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return;
  await prisma.notification.updateMany({ where: { id, userId: session.user.id, readAt: null }, data: { readAt: new Date() } });
}

/** Marks everything of the caller's read — used when the notifications page opens. */
export async function markAllNotificationsRead(): Promise<void> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return;
  await prisma.notification.updateMany({ where: { userId: session.user.id, readAt: null }, data: { readAt: new Date() } });
}
