import { prisma } from "./prisma";
import { getAutomationSettings } from "./automation";
import { bangkokDateKey, pickedDateKey } from "./date";
import { eachDayKey, isWorkday, loadWorkCalendar, weekdayOfKey } from "./workdays";
import { notifyUser } from "./notify";

/**
 * Automatic ABSENT ("ขาดงาน"). Once a day (after midnight) the scheduler
 * looks back over the last few days and, for every active teacher who has
 * started using the app, marks a work day ABSENT when there is:
 *   - no check-in and no check-out,
 *   - no approved leave (whole or half day),
 *   - and it really was a work day for them — a configured work weekday
 *     that isn't a holiday in ปฏิทินโรงเรียน for their primary site
 *     (optionally: only days they have a class in the timetable).
 * Never overwrites anything: days with any record are left alone. A later
 * approved leave or check-in attestation replaces the ABSENT status as
 * usual. Off by default; only days on/after absentFromDate (go-live) count.
 */
const LOOKBACK_DAYS = 7;

/** Bangkok-midnight Date for a day key — the Attendance.date convention. */
export function attendanceDateOf(key: string) {
  return new Date(`${key}T00:00:00+07:00`);
}

export async function markAbsences(now = new Date()): Promise<number> {
  const s = await getAutomationSettings();
  if (!s.autoAbsent || !s.absentFromDate) return 0;
  const today = bangkokDateKey(now);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const lookback = new Date(Date.parse(`${today}T00:00:00Z`) - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const from = s.absentFromDate > lookback ? s.absentFromDate : lookback;
  if (from > yesterday) return 0;
  const days = eachDayKey(from, yesterday);

  const [cal, teachers] = await Promise.all([
    loadWorkCalendar(from, yesterday),
    prisma.user.findMany({
      where: { role: "MEMBER", isActive: true, lastLoginAt: { not: null }, campusLocationId: { not: null } },
      select: { id: true, campusLocationId: true, createdAt: true },
    }),
  ]);
  if (teachers.length === 0) return 0;
  const ids = teachers.map((t) => t.id);
  const fromDate = attendanceDateOf(from);
  const toDate = attendanceDateOf(yesterday);

  const [rows, leaves, schedules] = await Promise.all([
    prisma.attendance.findMany({ where: { userId: { in: ids }, date: { gte: fromDate, lte: toDate } }, select: { userId: true, date: true, checkinAt: true, checkoutAt: true, status: true } }),
    prisma.leaveRequest.findMany({
      where: { requesterId: { in: ids }, status: "APPROVED", startDate: { lte: new Date(`${yesterday}T23:59:59Z`) }, endDate: { gte: new Date(`${from}T00:00:00Z`) } },
      select: { requesterId: true, startDate: true, endDate: true },
    }),
    s.absentOnlyTeachingDays
      ? prisma.schedule.findMany({ where: { teacherId: { in: ids } }, select: { teacherId: true, dayOfWeek: true, semester: { select: { startDate: true, endDate: true } } } })
      : Promise.resolve([]),
  ]);
  const rowByKey = new Map(rows.map((r) => [`${r.userId}:${bangkokDateKey(r.date)}`, r]));

  let marked = 0;
  for (const t of teachers) {
    const joined = bangkokDateKey(t.createdAt);
    const absentDays: string[] = [];
    for (const key of days) {
      if (key < joined) continue;
      if (!isWorkday(cal, key, t.campusLocationId)) continue;
      if (leaves.some((l) => l.requesterId === t.id && pickedDateKey(l.startDate) <= key && key <= pickedDateKey(l.endDate))) continue;
      if (s.absentOnlyTeachingDays) {
        const wd = weekdayOfKey(key);
        const teaches = schedules.some((x) => x.teacherId === t.id && x.dayOfWeek === wd && pickedDateKey(x.semester.startDate) <= key && key <= pickedDateKey(x.semester.endDate));
        if (!teaches) continue;
      }
      const row = rowByKey.get(`${t.id}:${key}`);
      if (row && (row.checkinAt || row.checkoutAt || row.status !== "PENDING")) continue;
      const date = attendanceDateOf(key);
      if (row) {
        const res = await prisma.attendance.updateMany({ where: { userId: t.id, date, checkinAt: null, checkoutAt: null, status: "PENDING" }, data: { status: "ABSENT" } });
        if (res.count === 0) continue;
      } else {
        try {
          await prisma.attendance.create({ data: { userId: t.id, date, status: "ABSENT" } });
        } catch {
          continue; // someone stamped that day meanwhile — leave it alone
        }
      }
      absentDays.push(key);
      marked++;
    }
    if (absentDays.length > 0) {
      await notifyUser(t.id, "ABSENT_MARKED", { dates: absentDays.join(","), count: absentDays.length }, "/attest");
    }
  }
  return marked;
}
