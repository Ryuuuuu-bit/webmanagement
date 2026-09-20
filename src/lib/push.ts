import webpush from "web-push";
import { prisma } from "./prisma";

/**
 * Web Push delivery (VAPID). Configured only when the three env vars are
 * set — otherwise every function here is a no-op, so the app keeps working
 * without push. Sending is best-effort and never throws into callers.
 */

let configured: boolean | null = null;

export function isPushConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (configured = false);
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);
    configured = true;
  } catch {
    configured = false;
  }
  return configured;
}

export function getPublicVapidKey(): string | null {
  return isPushConfigured() ? process.env.VAPID_PUBLIC_KEY ?? null : null;
}

export type PushPayload = { title: string; body: string; href: string | null; tag?: string };
type SubRow = { id: string; endpoint: string; p256dh: string; auth: string; locale: string };

/** Sends one payload to every subscription of the given users. Dead subscriptions are removed. */
export async function sendPushToUsers(userIds: string[], render: (locale: string) => PushPayload): Promise<void> {
  if (!isPushConfigured() || userIds.length === 0) return;
  try {
    const subs: SubRow[] = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
    if (subs.length === 0) return;
    const dead: string[] = [];
    await Promise.all(
      subs.map(async (s: SubRow) => {
        const payload = JSON.stringify(render(s.locale));
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24 });
        } catch (err) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) dead.push(s.id);
        }
      })
    );
    if (dead.length > 0) await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } });
    await prisma.pushSubscription.updateMany({ where: { id: { in: subs.filter((s: SubRow) => !dead.includes(s.id)).map((s: SubRow) => s.id) } }, data: { lastUsedAt: new Date() } });
  } catch {
    // Push must never take the real action down with it.
  }
}
