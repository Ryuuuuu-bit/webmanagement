import { prisma } from "./prisma";

export type CheckinPolicy = {
  requireBiometricCheckin: boolean;
  requireSelfieCheckin: boolean;
  deviceApprovalRequired: boolean;
  selfieRetentionDays: number;
  /** Default working hours, "HH:MM" Thai time; sites may override (getWorkHours). */
  workStart: string;
  workEnd: string;
  /** Minutes after workStart a check-in still counts as ON_TIME. */
  lateGraceMinutes: number;
  /** "HH:MM" — when the afternoon starts; the late cut-off on a morning half-day leave. */
  afternoonStart: string;
};

export const DEFAULT_POLICY: CheckinPolicy = {
  requireBiometricCheckin: true,
  requireSelfieCheckin: true,
  deviceApprovalRequired: true,
  selfieRetentionDays: 90,
  workStart: "08:30",
  workEnd: "17:00",
  lateGraceMinutes: 0,
  afternoonStart: "13:00",
};

export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The single AppSetting row (created with defaults on first read). */
export async function getCheckinPolicy(): Promise<CheckinPolicy> {
  const row = await prisma.appSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
  return {
    requireBiometricCheckin: row.requireBiometricCheckin,
    requireSelfieCheckin: row.requireSelfieCheckin,
    deviceApprovalRequired: row.deviceApprovalRequired,
    selfieRetentionDays: row.selfieRetentionDays,
    workStart: row.workStart ?? DEFAULT_POLICY.workStart,
    workEnd: row.workEnd ?? DEFAULT_POLICY.workEnd,
    lateGraceMinutes: row.lateGraceMinutes ?? DEFAULT_POLICY.lateGraceMinutes,
    afternoonStart: row.afternoonStart ?? DEFAULT_POLICY.afternoonStart,
  };
}

export type WorkHours = { start: string; end: string; graceMinutes: number; fromSite: boolean };

/**
 * Effective working hours for a teacher: their site's overrides when set,
 * otherwise the global defaults. Different companies/branches start at
 * different times, so this is per site rather than one number for everyone.
 */
export async function getWorkHoursForUser(userId: string): Promise<WorkHours> {
  const [policy, user] = await Promise.all([
    getCheckinPolicy(),
    prisma.user.findUnique({
      where: { id: userId },
      select: { campusLocation: { select: { workStart: true, workEnd: true, lateGraceMinutes: true } } },
    }),
  ]);
  return workHoursForSite(user?.campusLocation ?? null, policy);
}

type SiteHours = { workStart: string | null; workEnd: string | null; lateGraceMinutes: number | null };

/** Hours at one specific site (teachers with several sites use the hours of the site they stamped at). */
export function workHoursForSite(site: SiteHours | null, policy: CheckinPolicy): WorkHours {
  const fromSite = !!(site && (site.workStart || site.workEnd || site.lateGraceMinutes !== null));
  return {
    start: site?.workStart || policy.workStart,
    end: site?.workEnd || policy.workEnd,
    graceMinutes: site?.lateGraceMinutes ?? policy.lateGraceMinutes,
    fromSite,
  };
}

/** Date for "HH:MM" on the given calendar day (server runs in Asia/Bangkok). */
export function atTimeOfDay(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Latest on-time check-in moment for a day: start + grace — or, on an
 * approved MORNING half-day leave, the afternoon start + grace (they're
 * expected after lunch, so arriving then is not "late").
 */
export function lateCutoff(day: Date, hours: WorkHours, halfDayLeave: "AM" | "PM" | null, policy: CheckinPolicy): Date {
  const start = halfDayLeave === "AM" && policy.afternoonStart > hours.start ? policy.afternoonStart : hours.start;
  return new Date(atTimeOfDay(day, start).getTime() + hours.graceMinutes * 60_000);
}
