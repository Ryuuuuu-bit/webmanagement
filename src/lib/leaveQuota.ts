import { LeaveType, RequestStatus } from "@prisma/client";
import { prisma } from "./prisma";

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

function dateOnlyUTC(d: Date) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Inclusive whole-day count between two dates — no holiday/weekend awareness, matching how the rest of the app treats leave dates. */
export function countLeaveDays(start: Date, end: Date): number {
  return Math.round((dateOnlyUTC(end) - dateOnlyUTC(start)) / 86400000) + 1;
}

/**
 * This requester's total day-count of `type` leave requests starting in
 * `year`, counting PENDING and APPROVED (not REJECTED) — a pending request
 * provisionally holds its days against the quota until it's decided, same as
 * an approved one, so the warning below reflects requests still awaiting a
 * decision too.
 */
export async function getLeaveUsedDays(requesterId: string, type: LeaveType, year: number): Promise<number> {
  const requests = await prisma.leaveRequest.findMany({
    where: {
      requesterId,
      type,
      status: { in: [RequestStatus.PENDING, RequestStatus.APPROVED] },
      startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59)) },
    },
    select: { startDate: true, endDate: true },
  });
  return requests.reduce((sum, r) => sum + countLeaveDays(r.startDate, r.endDate), 0);
}

export type LeaveQuotaStatus = { type: LeaveType; quota: number; used: number; remaining: number | null };

/** Per-type quota/used/remaining for one teacher's current calendar year — quota=0 (unlimited) reports remaining=null rather than a meaningless number. */
export async function getLeaveQuotaStatusForUser(userId: string, year = new Date().getUTCFullYear()): Promise<LeaveQuotaStatus[]> {
  const quotaMap = await getLeaveQuotaMap();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  const requests = await prisma.leaveRequest.findMany({
    where: {
      requesterId: userId,
      status: { in: [RequestStatus.PENDING, RequestStatus.APPROVED] },
      startDate: { gte: yearStart, lte: yearEnd },
    },
    select: { type: true, startDate: true, endDate: true },
  });
  const usedByType = new Map<LeaveType, number>();
  for (const r of requests) {
    usedByType.set(r.type, (usedByType.get(r.type) ?? 0) + countLeaveDays(r.startDate, r.endDate));
  }
  return LEAVE_TYPES.map((type) => {
    const quota = quotaMap[type];
    const used = usedByType.get(type) ?? 0;
    return { type, quota, used, remaining: quota === 0 ? null : Math.max(0, quota - used) };
  });
}
