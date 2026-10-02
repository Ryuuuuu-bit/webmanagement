import { prisma } from "./prisma";

/**
 * Admin-tunable automation: scheduled reminders (src/lib/scheduler.ts) and
 * PDPA data-retention windows. Stored on the single AppSetting row next to
 * the check-in policy, edited in Master Data → "การแจ้งเตือนอัตโนมัติ".
 */
export type AutomationSettings = {
  remindCheckin: boolean;
  /** Minutes after (start + grace) before nudging someone who hasn't checked in. */
  remindCheckinAfterMin: number;
  remindCheckout: boolean;
  /** Minutes after the site's end time before nudging someone who hasn't checked out. */
  remindCheckoutAfterMin: number;
  /** Days that count as work days for check-in reminders, 0=Mon..6=Sun. */
  remindWeekdays: number[];
  pendingDigest: boolean;
  /** A request counts as "waiting too long" after this many days. */
  pendingDigestDays: number;
  /** "HH:MM" — the daily digest to Admins goes out at/after this time. */
  pendingDigestTime: string;
  lessonPlanReminders: boolean;
  /** Delete attendance / attestation / leave records older than this (0 = keep). */
  attendanceRetentionMonths: number;
  /** Strip leave & feedback file attachments older than this (0 = keep). */
  attachmentRetentionMonths: number;
  /** Mark work days with no check-in/out and no leave as ABSENT (src/lib/absence.ts). */
  autoAbsent: boolean;
  /** "YYYY-MM-DD" — first day that can be marked absent (go-live), or "" . */
  absentFromDate: string;
  /** Only days the teacher has a class in the timetable count as work days for absence. */
  absentOnlyTeachingDays: boolean;
};

export function parseWeekdays(s: string | null | undefined): number[] {
  return Array.from(new Set((s ?? "").split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))).sort();
}

export async function getAutomationSettings(): Promise<AutomationSettings> {
  const row = await prisma.appSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
  return {
    remindCheckin: row.remindCheckin,
    remindCheckinAfterMin: row.remindCheckinAfterMin,
    remindCheckout: row.remindCheckout,
    remindCheckoutAfterMin: row.remindCheckoutAfterMin,
    remindWeekdays: parseWeekdays(row.remindWeekdays),
    pendingDigest: row.pendingDigest,
    pendingDigestDays: row.pendingDigestDays,
    pendingDigestTime: row.pendingDigestTime,
    lessonPlanReminders: row.lessonPlanReminders,
    attendanceRetentionMonths: row.attendanceRetentionMonths,
    attachmentRetentionMonths: row.attachmentRetentionMonths,
    autoAbsent: row.autoAbsent,
    absentFromDate: row.absentFromDate ? row.absentFromDate.toISOString().slice(0, 10) : "",
    absentOnlyTeachingDays: row.absentOnlyTeachingDays,
  };
}
