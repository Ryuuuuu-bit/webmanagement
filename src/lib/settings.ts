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
};

export const DEFAULT_POLICY: CheckinPolicy = {
  requireBiometricCheckin: true,
  requireSelfieCheckin: true,
  deviceApprovalRequired: true,
  selfieRetentionDays: 90,
  workStart: "08:30",
  workEnd: "17:00",
  lateGraceMinutes: 0,
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
  const site = user?.campusLocation;
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
