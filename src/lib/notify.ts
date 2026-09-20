import { prisma } from "./prisma";
import { formatDate } from "./date";
import { getDictionary, type Dictionary, type Locale } from "./i18n/dictionaries";

/**
 * In-app notifications ("แจ้งเตือน"). Every workflow step that concerns
 * someone *else* creates a row for each person who should know:
 *
 *   teacher submits a leave / attestation / lesson plan  → every active Admin
 *   Admin approves / rejects / sends back                 → the requester
 *   teacher registers a device that needs approval        → every active Admin
 *   Admin approves / rejects that device                  → the teacher
 *   the same phone checks in for two teachers             → every active Admin
 *   Admin adds / removes a class on a teacher's timetable → that teacher
 *   Admin changes a teacher's role or assigned site       → that teacher
 *
 * The row stores a `kind` plus the raw facts (names, dates, decision) and the
 * text is produced at read time in the *reader's* language (renderNotification
 * below), so an Admin reading in English and a teacher reading in Thai each
 * see their own. Writes are best-effort — a notification failure must never
 * take the real action down with it.
 */

export type NotificationKind =
  | "LEAVE_REQUESTED"
  | "LEAVE_DECIDED"
  | "ATTEST_REQUESTED"
  | "ATTEST_DECIDED"
  | "LESSON_PLAN_SUBMITTED"
  | "LESSON_PLAN_REVIEWED"
  | "DEVICE_PENDING"
  | "DEVICE_DECIDED"
  | "SHARED_DEVICE_DETECTED"
  | "SCHEDULE_ASSIGNED"
  | "SCHEDULE_REMOVED"
  | "ROLE_CHANGED"
  | "SITE_ASSIGNED"
  | "PASSWORD_TEMP";

export type NotificationParams = Record<string, string | number | boolean | null>;

const RETENTION_DAYS = 90;
const MAX_PER_USER_PAGE = 50;

async function pruneOld() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

/** One notification for one person. */
export async function notifyUser(userId: string, kind: NotificationKind, params: NotificationParams, href: string | null) {
  try {
    await prisma.notification.create({ data: { userId, kind, params, href } });
    if (Math.random() < 0.05) await pruneOld();
  } catch {
    // Never fail the action that triggered it.
  }
}

/** The same notification for every active Admin (optionally skipping the one who caused it). */
export async function notifyAdmins(kind: NotificationKind, params: NotificationParams, href: string | null, opts: { excludeUserId?: string } = {}) {
  try {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    const rows = admins.filter((a) => a.id !== opts.excludeUserId).map((a) => ({ userId: a.id, kind, params, href }));
    if (rows.length > 0) await prisma.notification.createMany({ data: rows });
    if (Math.random() < 0.05) await pruneOld();
  } catch {
    // Never fail the action that triggered it.
  }
}

export type RenderedNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
};

/**
 * Turns a stored row into text in the reader's language. Unknown kinds (a
 * row written by a newer build during a rolling deploy) fall back to a
 * generic line rather than crashing the bell.
 */
export function renderNotification(
  row: { id: string; kind: string; params: unknown; href: string | null; readAt: Date | null; createdAt: Date },
  dict: Dictionary,
  locale: Locale
): RenderedNotification {
  const p = (row.params && typeof row.params === "object" ? row.params : {}) as NotificationParams;
  const kinds = dict.notifications.kinds as Record<string, (p: NotificationParams, h: RenderHelpers) => { title: string; body: string }>;
  const helpers: RenderHelpers = {
    date: (v) => (typeof v === "string" && v ? formatDate(v, locale) : "-"),
    leaveType: (v) => (dict.leave.types as Record<string, string>)[String(v)] ?? String(v ?? "-"),
    attestType: (v) => (dict.attest.types as Record<string, string>)[String(v)] ?? String(v ?? "-"),
    dayName: (v) => dict.day.full[Number(v)] ?? "-",
  };
  const render = kinds[row.kind];
  const text = render ? render(p, helpers) : { title: dict.notifications.genericTitle, body: "" };
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    title: text.title,
    body: text.body,
    href: row.href,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export type RenderHelpers = {
  date: (v: NotificationParams[string]) => string;
  leaveType: (v: NotificationParams[string]) => string;
  attestType: (v: NotificationParams[string]) => string;
  dayName: (v: NotificationParams[string]) => string;
};

export async function countUnread(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/** Latest notifications for the bell/page, newest first. */
export async function listNotifications(userId: string, locale: Locale, opts: { limit?: number; unreadOnly?: boolean } = {}) {
  const dict = getDictionary(locale);
  const rows = await prisma.notification.findMany({
    where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 20, MAX_PER_USER_PAGE),
  });
  return rows.map((r: { id: string; kind: string; params: unknown; href: string | null; readAt: Date | null; createdAt: Date }) => renderNotification(r, dict, locale));
}
