import { prisma } from "./prisma";
import { getAutomationSettings } from "./automation";
import { atTimeOfDay, getCheckinPolicy, workHoursForSite } from "./settings";
import { bangkokDateKey, pickedDateKey } from "./date";
import { isWorkday, loadWorkCalendar, weekdayOfKey } from "./workdays";
import { attendanceDateOf } from "./absence";
import { notifyAdmins, notifyUser } from "./notify";

/**
 * Same-day attendance (runs every scheduler tick), per school:
 *
 *  1. ABSENT cut-off — when a school's start time + N minutes passes
 *     (N = the site's absentAfterMinutes, else the global setting; 0 = off)
 *     every teacher of that school who is due at work today and has no
 *     check-in/out is marked ABSENT and told so. "Due at work" means: a work
 *     weekday that isn't a holiday in ปฏิทินโรงเรียน, no leave covering the
 *     day (approved OR still pending — a teacher who filed leave this
 *     morning shouldn't be marked absent before Admin gets to it), and, with
 *     "only teaching days", a class in today's timetable. A morning half-day
 *     leave moves their cut-off to the afternoon start + N. Requires the
 *     automatic-absence switch and its go-live date (same as the nightly
 *     job in absence.ts). Checking in later still works and is recorded as
 *     LATE; checking out only puts the day back to "awaiting attestation".
 *
 *  2. Daily summary — once per school per day, at that cut-off (or start +
 *     grace + 60 min when no cut-off is set), Admins get the counts: on
 *     time / late / not in yet / absent / on leave.
 *
 * Both are claimed through ReminderLog keys, so they happen once per day no
 * matter how many ticks or replicas run.
 */

type Claim = (key: string) => Promise<boolean>;

export async function runDailyAttendance(now: Date, claim: Claim): Promise<{ absent: number; summaries: number }> {
  const out = { absent: 0, summaries: 0 };
  const s = await getAutomationSettings();
  const todayKey = bangkokDateKey(now);
  const sameDayAbsent = s.autoAbsent && !!s.absentFromDate && s.absentFromDate <= todayKey;
  if (!sameDayAbsent && !s.dailySummary) return out;

  const [cal, policy, sites] = await Promise.all([
    loadWorkCalendar(todayKey, todayKey),
    getCheckinPolicy(),
    prisma.campusLocation.findMany({ select: { id: true, name: true, workStart: true, workEnd: true, lateGraceMinutes: true, absentAfterMinutes: true } }),
  ]);
  const today = attendanceDateOf(todayKey);
  const day = new Date(`${todayKey}T00:00:00.000Z`); // picked-date convention (leave)

  for (const site of sites) {
    if (!isWorkday(cal, todayKey, site.id)) continue;
    const hours = workHoursForSite(site, policy);
    const absentMin = site.absentAfterMinutes ?? s.absentAfterMinutes;
    const start = atTimeOfDay(today, hours.start);
    const cutoff = absentMin > 0 ? new Date(+start + absentMin * 60_000) : null;
    const summaryAt = cutoff ?? new Date(+start + (hours.graceMinutes + 60) * 60_000);
    // Nothing to do for this school until its earliest due moment.
    const due = [sameDayAbsent ? cutoff : null, s.dailySummary ? summaryAt : null].filter((d): d is Date => !!d);
    if (due.length === 0 || now < new Date(Math.min(...due.map(Number)))) continue;

    const teachers = await prisma.user.findMany({
      where: { role: "MEMBER", isActive: true, campusLocationId: site.id },
      select: { id: true, lastLoginAt: true, createdAt: true },
    });
    if (teachers.length === 0) continue;
    const ids = teachers.map((t) => t.id);
    const [rows, leaves, teaching] = await Promise.all([
      prisma.attendance.findMany({ where: { userId: { in: ids }, date: today }, select: { userId: true, status: true, checkinAt: true, checkoutAt: true } }),
      prisma.leaveRequest.findMany({
        where: { requesterId: { in: ids }, status: { in: ["APPROVED", "PENDING"] }, startDate: { lte: day }, endDate: { gte: day } },
        select: { requesterId: true, status: true, halfDay: true },
      }),
      s.absentOnlyTeachingDays
        ? prisma.schedule.findMany({
            where: { teacherId: { in: ids }, dayOfWeek: weekdayOfKey(todayKey), semester: { startDate: { lte: day }, endDate: { gte: day } } },
            select: { teacherId: true },
          })
        : Promise.resolve(null),
    ]);
    const rowBy = new Map(rows.map((r) => [r.userId, r]));
    const teachesToday = teaching ? new Set(teaching.map((x) => x.teacherId)) : null;

    // --- 1. same-day ABSENT ------------------------------------------------
    if (sameDayAbsent && cutoff && now < atTimeOfDay(today, hours.end)) {
      for (const t of teachers) {
        if (!t.lastLoginAt || bangkokDateKey(t.createdAt) > todayKey) continue;
        if (teachesToday && !teachesToday.has(t.id)) continue;
        const myLeaves = leaves.filter((l) => l.requesterId === t.id);
        if (myLeaves.some((l) => !l.halfDay)) continue; // whole-day leave (approved or pending)
        // Morning half-day leave: due in the afternoon instead.
        const amLeave = myLeaves.some((l) => l.halfDay === "AM");
        const myCutoff = amLeave && policy.afternoonStart > hours.start ? new Date(+atTimeOfDay(today, policy.afternoonStart) + absentMin * 60_000) : cutoff;
        if (now < myCutoff) continue;
        const row = rowBy.get(t.id);
        if (row && (row.checkinAt || row.checkoutAt || row.status !== "PENDING")) continue;
        let marked = false;
        if (row) {
          marked = (await prisma.attendance.updateMany({ where: { userId: t.id, date: today, checkinAt: null, checkoutAt: null, status: "PENDING" }, data: { status: "ABSENT" } })).count > 0;
        } else {
          try {
            await prisma.attendance.create({ data: { userId: t.id, date: today, status: "ABSENT" } });
            marked = true;
          } catch {
            marked = false; // they stamped in the meantime
          }
        }
        if (marked) {
          rowBy.set(t.id, { userId: t.id, status: "ABSENT", checkinAt: null, checkoutAt: null });
          out.absent++;
          if (await claim(`absent-today:${t.id}:${todayKey}`)) {
            const at = myCutoff.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
            await notifyUser(t.id, "ABSENT_TODAY", { time: at, site: site.name }, "/checkin");
          }
        }
      }
    }

    // --- 2. summary to Admins ----------------------------------------------
    if (s.dailySummary && now >= summaryAt && (await claim(`summary:${site.id}:${todayKey}`))) {
      const c = { onTime: 0, late: 0, notYet: 0, absent: 0, leave: 0 };
      for (const t of teachers) {
        const row = rowBy.get(t.id);
        const onLeave = leaves.some((l) => l.requesterId === t.id && l.status === "APPROVED" && !l.halfDay);
        if (row?.status === "LEAVE" || (onLeave && !row?.checkinAt)) c.leave++;
        else if (row?.status === "ON_TIME") c.onTime++;
        else if (row?.status === "LATE") c.late++;
        else if (row?.status === "ABSENT") c.absent++;
        else c.notYet++;
      }
      await notifyAdmins("ATTENDANCE_SUMMARY", { site: site.name, date: pickedDateKey(day), total: teachers.length, ...c }, "/dashboard");
      out.summaries++;
    }
  }
  return out;
}
