"use server";

import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPublicVapidKey } from "@/lib/push";
import { getLocale } from "@/lib/i18n/locale";

/** Public VAPID key for the browser (null when push isn't configured on the server). */
export async function getPushPublicKey(): Promise<string | null> {
  return getPublicVapidKey();
}

/** Stores (or refreshes) this browser's push subscription for the signed-in person. */
export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<{ ok: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false };
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false };
  const locale = getLocale();
  const userAgent = headers().get("user-agent")?.slice(0, 200) ?? null;
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId: session.user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, locale, userAgent },
    update: { userId: session.user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, locale, userAgent },
  });
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false };
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: session.user.id } });
  return { ok: true };
}

/** Whether this browser's subscription (by endpoint) is registered for the current user. */
export async function hasPushSubscription(endpoint: string): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return false;
  const row = await prisma.pushSubscription.findUnique({ where: { endpoint }, select: { userId: true } });
  return !!row && row.userId === session.user.id;
}
