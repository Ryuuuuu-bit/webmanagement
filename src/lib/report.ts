import type { LeaveType } from "@prisma/client";
import { prisma } from "./prisma";
import { bangkokDateKey, pickedDateKey } from "./date";
import { eachDayKey, isWorkday, loadWorkCalendar } from "./workdays";
import { CALENDAR_DAY_LEAVE_TYPES, LEAVE_TYPES } from "./leaveQuota";
import { getCheckinPolicy, lateCutoff, workHoursForSite } from "./settings";

/**
 * Monthly attendance report (Admin → รายงาน, and the Excel export).
 * One row per teacher plus the day-by-day records and the month's leave.
 *
 *  workdays   : configured work weekdays minus school holidays (primary site),
 *               counted up to today for the current month
 *  present    : days with a check-in or a check-out (weekend work included;
 *               the rate only counts work days)
 *  noRecord   : past work days with no record at all and no approved leave
 *               (becomes "absent" once automatic ABSENT is on)
 *  leaveDays  : approved leave days inside the month (work days, except
 *               calendar-day types such as maternity)
 */
export type SummaryRow = {
  userId: string;
  name: string;
  username: string;
  department: string;
  site: string;
  isActive: boolean;
  workdays: number;
  present: number;
  onTime: number;
  late: number;
  lateMinutes: number;
  earlyCheckout: number;
  absent: number;
  noRecord: number;
  leaveDays: number;
  leaveByType: Record<string, number>;
  attested: number;
  /** days present on work days ÷ (workdays − leave days), 0–100, null when nothing was expected. */
  rate: number | null;
};

export type DayRow = {
  date: string;
  userId: string;
  name: string;
  department: string;
  status: string;
  checkin: Date | null;
  checkout: Date | null;
  checkinSite: string | null;
  checkoutSite: string | null;
  attestedCheckin: boolean;
  attestedCheckout: boolean;
  earlyCheckout: boolean;
};

export type LeaveRow = { name: string; type: LeaveType; from: string; to: string; halfDay: string | null; days: number; reason: string };

export type MonthlyReport = { month: string; fromKey: string; toKey: string; countedUntil: string; summary: SummaryRow[]; days: DayRow[]; leaves: LeaveRow[] };

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function buildMonthlyReport(opts: { month: string; siteId?: string | null; departmentId?: string | null }): Promise<MonthlyReport> {
  const [y, m] = opts.month.split("-").map(Number);
  const fromKey = `${opts.month}-01`;
  const toKey = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const today = bangkokDateKey();
  // Work days / "no record" only count days that are already over.
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const countedUntil = toKey < today ? toKey : today;
  const pastUntil = toKey < today ? toKey : yesterday;

  const teachers = await prisma.user.findMany({
    where: {
      role: "MEMBER",
      ...(opts.siteId ? { campusLocationId: opts.siteId } : {}),
      ...(opts.departmentId ? { departmentId: opts.departmentId } : {}),
    },
    select: { id: true, name: true, username: true, isActive: true, createdAt: true, campusLocationId: true, campusLocation: true, department: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const ids = teachers.map((t) => t.id);
  const fromDate = new Date(`${fromKey}T00:00:00+07:00`);
  const toDate = new Date(`${toKey}T23:59:59+07:00`);

  const [cal, policy, sites, rows, leaves, attests] = await Promise.all([
    loadWorkCalendar(fromKey, toKey),
    getCheckinPolicy(),
    prisma.campusLocation.findMany({ select: { id: true, workStart: true, workEnd: true, lateGraceMinutes: true } }),
    prisma.attendance.findMany({ where: { userId: { in: ids }, date: { gte: fromDate, lte: toDate } }, orderBy: { date: "asc" } }),
    prisma.leaveRequest.findMany({
      where: { requesterId: { in: ids }, status: "APPROVED", startDate: { lte: new Date(`${toKey}T23:59:59Z`) }, endDate: { gte: new Date(`${fromKey}T00:00:00Z`) } },
      select: { requesterId: true, type: true, startDate: true, endDate: true, halfDay: true, reason: true },
      orderBy: { startDate: "asc" },
    }),
    prisma.timeAttestation.groupBy({ by: ["requesterId"], where: { requesterId: { in: ids }, status: "APPROVED", date: { gte: new Date(`${fromKey}T00:00:00Z`), lte: new Date(`${toKey}T23:59:59Z`) } }, _count: true }),
  ]);
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const attestBy = new Map(attests.map((a) => [a.requesterId, a._count]));
  const monthDays = eachDayKey(fromKey, toKey);

  const summary: SummaryRow[] = [];
  const dayRows: DayRow[] = [];
  const leaveRows: LeaveRow[] = [];

  for (const t of teachers) {
    const mine = rows.filter((r) => r.userId === t.id);
    const myLeaves = leaves.filter((l) => l.requesterId === t.id);
    const joined = bangkokDateKey(t.createdAt);
    const isWd = (k: string) => k >= joined && isWorkday(cal, k, t.campusLocationId);
    const rowByKey = new Map(mine.map((r) => [bangkokDateKey(r.date), r]));
    const leaveOn = (k: string) => myLeaves.find((l) => pickedDateKey(l.startDate) <= k && k <= pickedDateKey(l.endDate));

    // Leave days inside the month.
    const leaveByType: Record<string, number> = {};
    let leaveDays = 0;
    for (const l of myLeaves) {
      let n = 0;
      if (l.halfDay) n = pickedDateKey(l.startDate) >= fromKey && pickedDateKey(l.startDate) <= toKey ? 0.5 : 0;
      else for (const k of eachDayKey(pickedDateKey(l.startDate) > fromKey ? pickedDateKey(l.startDate) : fromKey, pickedDateKey(l.endDate) < toKey ? pickedDateKey(l.endDate) : toKey)) {
        if (CALENDAR_DAY_LEAVE_TYPES.has(l.type) || isWorkday(cal, k, t.campusLocationId)) n++;
      }
      leaveByType[l.type] = (leaveByType[l.type] ?? 0) + n;
      leaveDays += n;
      if (n > 0) leaveRows.push({ name: t.name, type: l.type, from: pickedDateKey(l.startDate), to: pickedDateKey(l.endDate), halfDay: l.halfDay, days: n, reason: l.reason });
    }

    let present = 0, presentOnWorkdays = 0, onTime = 0, late = 0, lateMinutes = 0, early = 0, absent = 0;
    for (const r of mine) {
      if (r.checkinAt || r.checkoutAt) {
        present++;
        if (isWd(bangkokDateKey(r.date))) presentOnWorkdays++;
      }
      if (r.status === "ON_TIME") onTime++;
      if (r.status === "LATE") {
        late++;
        if (r.checkinAt) {
          const site = siteById.get(r.checkinSiteId ?? t.campusLocationId ?? "") ?? null;
          const half = (() => {
            const l = leaveOn(bangkokDateKey(r.date));
            return l?.halfDay === "AM" ? "AM" : null;
          })();
          const cutoff = lateCutoff(r.date, workHoursForSite(site, policy), half, policy);
          lateMinutes += Math.max(0, Math.round((+r.checkinAt - +cutoff) / 60_000));
        }
      }
      if (r.earlyCheckout) early++;
      if (r.status === "ABSENT") absent++;
      dayRows.push({
        date: bangkokDateKey(r.date),
        userId: t.id,
        name: t.name,
        department: t.department?.name ?? "",
        status: !r.checkinAt && r.checkoutAt && r.status === "PENDING" ? "AWAITING_ATTEST" : r.status,
        checkin: r.checkinAt,
        checkout: r.checkoutAt,
        checkinSite: r.checkinSiteName,
        checkoutSite: r.checkoutSiteName,
        attestedCheckin: r.attestedCheckin,
        attestedCheckout: r.attestedCheckout,
        earlyCheckout: r.earlyCheckout,
      });
    }

    const workdays = monthDays.filter((k) => k <= countedUntil && isWd(k)).length;
    const noRecord = monthDays.filter((k) => k <= pastUntil && isWd(k) && !rowByKey.has(k) && !leaveOn(k)).length;
    const expected = workdays - leaveDays;
    summary.push({
      userId: t.id,
      name: t.name,
      username: t.username ?? "",
      department: t.department?.name ?? "",
      site: t.campusLocation?.name ?? "",
      isActive: t.isActive,
      workdays,
      present,
      onTime,
      late,
      lateMinutes,
      earlyCheckout: early,
      absent,
      noRecord,
      leaveDays,
      leaveByType,
      attested: attestBy.get(t.id) ?? 0,
      rate: expected > 0 ? Math.min(100, Math.round((presentOnWorkdays / expected) * 1000) / 10) : null,
    });
  }

  // Keep suspended accounts only when they have something in the month.
  const visible = summary.filter((r) => r.isActive || r.present + r.leaveDays + r.absent > 0);
  dayRows.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, "th") : a.date < b.date ? -1 : 1));
  return { month: opts.month, fromKey, toKey, countedUntil, summary: visible, days: dayRows, leaves: leaveRows };
}

export { LEAVE_TYPES };
