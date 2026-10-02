import { LeaveType, RequestStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { bangkokDateKey, pickedDateKey } from "./date";
import { countWorkdays, loadWorkCalendar, type WorkCalendar } from "./workdays";

// Every leave category the app tracks, in the order they should be shown —
// mirrors the LeaveType enum in prisma/schema.prisma.
export const LEAVE_TYPES: LeaveType[] = [
  "SICK",
  "PERSONAL",
  "VACATION",
  "MATERNITY",
  "STERILIZATION",
  "MILITARY",
  "TRAINING",
] as LeaveType[];

// Starting quotas follow the Thai Labor Protection Act's statutory MINIMUM
// paid leave entitlements per calendar year (พระราชบัญญัติคุ้มครองแรงงาน)
// — a sensible default until Admin adjusts them in Master Data. These are
// legal minimums the employer must allow at least; nothing stops Admin from
// raising them. 0 means "unlimited" (no annual cap shown/enforced), used for
// the two categories the law doesn't set a fixed day count for.
export const DEFAULT_LEAVE_QUOTA_DAYS: Record<LeaveType, number> = {
  SICK: 30, // ม.32 — paid up to 30 working days/year
  PERSONAL: 3, // ม.34 (แก้ไขเพิ่มเติม 2562) — at least 3 paid working days/year
  VACATION: 6, // ม.30 — at least 6 working days/year, after 1 year of service
  MATERNITY: 98, // ม.41 (แก้ไขเพิ่มเติม 2562) — up to 98 days per pregnancy, incl. holidays
  STERILIZATION: 0, // ม.33 — however long a doctor's certificate specifies; law sets no fixed cap
  MILITARY: 60, // ม.35 — paid up to 60 days/year
  TRAINING: 0, // ม.36-37 — no statutory day count; left to company policy
};

/** Every leave type's current effective quota (days/year) — DB overrides (Admin-edited in Master Data) merged over the statutory defaults above. */
export async function getLeaveQuotaMap(): Promise<Record<LeaveType, number>> {
  const rows = await prisma.leaveQuota.findMany();
  const map = { ...DEFAULT_LEAVE_QUOTA_DAYS };
  for (const row of rows) map[row.type as LeaveType] = row.daysPerYear;
  return map;
}

/**
 * Leave types counted in calendar days (the law counts holidays in them);
 * every other type counts only work days — Mon–Fri by default, minus
 * holidays in ปฏิทินโรงเรียน (see src/lib/workdays.ts). Leave Fri → Mon = 2 days.
 */
export const CALENDAR_DAY_LEAVE_TYPES = new Set<LeaveType>(["MATERNITY", "MILITARY"] as LeaveType[]);

/** Work-calendar context for counting one teacher's leave (null = plain calendar days). */
export type LeaveCountContext = { cal: WorkCalendar; siteId: string | null; type: LeaveType } | null;

function dateOnlyUTC(d: Date) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Days charged for a leave request (0.5 for a half-day). With a context, only work days count (except calendar-day types). */
export function countLeaveDays(start: Date, end: Date, halfDay?: string | null, ctx: LeaveCountContext = null): number {
  if (halfDay) return 0.5;
  if (ctx && !CALENDAR_DAY_LEAVE_TYPES.has(ctx.type)) return countWorkdays(ctx.cal, pickedDateKey(start), pickedDateKey(end), ctx.siteId);
  return Math.round((dateOnlyUTC(end) - dateOnlyUTC(start)) / 86400000) + 1;
}

/**
 * Same as countLeaveDays, but clamped to the days that actually fall inside
 * `year` — a request is charged against a SINGLE year's quota bucket by
 * startDate elsewhere in this file, but a request spanning New Year's (e.g.
 * Dec 30 → Jan 2) really only has some of its days in each year. Without
 * this clamp, all 4 days would land on the previous year's total and be
 * invisible to the new year's, making both years wrong.
 */
export function countLeaveDaysInYear(start: Date, end: Date, halfDay: string | null | undefined, year: number, ctx: LeaveCountContext = null): number {
  if (halfDay) return start.getUTCFullYear() === year ? 0.5 : 0;
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year, 11, 31);
  const clampedStart = Math.max(dateOnlyUTC(start), yearStart);
  const clampedEnd = Math.min(dateOnlyUTC(end), yearEnd);
  if (clampedEnd < clampedStart) return 0;
  if (ctx && !CALENDAR_DAY_LEAVE_TYPES.has(ctx.type)) {
    return countWorkdays(ctx.cal, new Date(clampedStart).toISOString().slice(0, 10), new Date(clampedEnd).toISOString().slice(0, 10), ctx.siteId);
  }
  return Math.round((clampedEnd - clampedStart) / 86400000) + 1;
}

/** Work calendar covering `year` plus the teacher's primary site, for counting their leave. */
export async function leaveCalendarFor(userId: string, year: number) {
  const [cal, user] = await Promise.all([
    loadWorkCalendar(`${year}-01-01`, `${year}-12-31`),
    prisma.user.findUnique({ where: { id: userId }, select: { campusLocationId: true } }),
  ]);
  return { cal, siteId: user?.campusLocationId ?? null };
}

/**
 * This requester's total day-count of `type` leave requests overlapping
 * `year` (clamped to the days actually in that year — see
 * countLeaveDaysInYear), counting PENDING and APPROVED (not REJECTED) — a
 * pending request provisionally holds its days against the quota until it's
 * decided, same as an approved one, so the warning below reflects requests
 * still awaiting a decision too.
 */
export async function getLeaveUsedDays(requesterId: string, type: LeaveType, year: number): Promise<number> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  const requests = await prisma.leaveRequest.findMany({
    where: {
      requesterId,
      type,
      status: { in: [RequestStatus.PENDING, RequestStatus.APPROVED] },
      // Overlap, not "starts in this year" — a Dec 30 → Jan 2 request must
      // still be found when checking either year's quota.
      startDate: { lte: yearEnd },
      endDate: { gte: yearStart },
    },
    select: { startDate: true, endDate: true, halfDay: true },
  });
  const { cal, siteId } = await leaveCalendarFor(requesterId, year);
  return requests.reduce((sum, r) => sum + countLeaveDaysInYear(r.startDate, r.endDate, r.halfDay, year, { cal, siteId, type }), 0);
}

export type LeaveQuotaStatus = { type: LeaveType; quota: number; used: number; remaining: number | null };

/** Per-type quota/used/remaining for one teacher's current calendar year — quota=0 (unlimited) reports remaining=null rather than a meaningless number. */
export async function getLeaveQuotaStatusForUser(userId: string, year = Number(bangkokDateKey().slice(0, 4))): Promise<LeaveQuotaStatus[]> {
  const quotaMap = await getLeaveQuotaMap();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  const requests = await prisma.leaveRequest.findMany({
    where: {
      requesterId: userId,
      status: { in: [RequestStatus.PENDING, RequestStatus.APPROVED] },
      // Overlap, not "starts in this year" — see getLeaveUsedDays.
      startDate: { lte: yearEnd },
      endDate: { gte: yearStart },
    },
    select: { type: true, startDate: true, endDate: true, halfDay: true },
  });
  const { cal, siteId } = await leaveCalendarFor(userId, year);
  const usedByType = new Map<LeaveType, number>();
  for (const r of requests) {
    usedByType.set(r.type, (usedByType.get(r.type) ?? 0) + countLeaveDaysInYear(r.startDate, r.endDate, r.halfDay, year, { cal, siteId, type: r.type }));
  }
  return LEAVE_TYPES.map((type) => {
    const quota = quotaMap[type];
    const used = usedByType.get(type) ?? 0;
    return { type, quota, used, remaining: quota === 0 ? null : Math.max(0, quota - used) };
  });
}
