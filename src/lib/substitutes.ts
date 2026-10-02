import type { GradeLevel } from "@prisma/client";
import { prisma } from "./prisma";
import { holidaysOn, isHolidayFor, keyToDate } from "./calendar";
import { bangkokDateKey, pickedDateKey } from "./date";
import { atTimeOfDay, getCheckinPolicy, workHoursForSite } from "./settings";

/**
 * Substitute-teacher planning ("หาครูสอนแทน") for one day:
 *   1. who is out — leave (approved or pending) covering the day, marked
 *      ABSENT, or (today only) not checked in after start + grace — plus any
 *      teacher the Admin adds by hand;
 *   2. each one's classes that weekday in the semester covering the day;
 *   3. for each class, teachers who are free then: same school, not out
 *      themselves, no overlapping class of their own, and teaching the
 *      course's grade band (when the course has one) — least busy first.
 */

export type AbsenceReason = "LEAVE" | "LEAVE_PENDING" | "ABSENT" | "NOT_CHECKED_IN" | "MANUAL";

export type Candidate = { id: string; name: string; classesToday: number; gradeMatch: boolean };
export type Slot = {
  scheduleId: string;
  start: string;
  end: string;
  courseCode: string;
  courseName: string;
  gradeLevel: GradeLevel | null;
  room: string;
  candidates: Candidate[];
};
export type AbsentTeacher = {
  id: string;
  name: string;
  siteName: string | null;
  reason: AbsenceReason;
  halfDay: string | null;
  gradeLevels: GradeLevel[];
  slots: Slot[];
};

const overlaps = (a1: string, a2: string, b1: string, b2: string) => a1 < b2 && b1 < a2;

/** Monday-first weekday (0 = Mon) of a "YYYY-MM-DD" key. */
function weekdayOfKey(key: string) {
  return (keyToDate(key).getUTCDay() + 6) % 7;
}

export async function buildSubstitutePlan(dateKey: string, manualIds: string[] = []) {
  const day = keyToDate(dateKey); // picked-date convention (leave, semesters)
  const attendanceDate = new Date(`${dateKey}T00:00:00+07:00`); // local-midnight convention (Attendance.date)
  const weekday = weekdayOfKey(dateKey);
  const isToday = dateKey === bangkokDateKey();

  const [teachers, leaves, attendance, semesters, holidays, policy] = await Promise.all([
    prisma.user.findMany({
      where: { role: "MEMBER", isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, gradeLevels: true, campusLocationId: true,
        campusLocation: { select: { name: true, workStart: true, workEnd: true, lateGraceMinutes: true } },
        extraSites: { select: { locationId: true } },
      },
    }),
    prisma.leaveRequest.findMany({
      where: { status: { in: ["APPROVED", "PENDING"] }, startDate: { lte: day }, endDate: { gte: day } },
      select: { requesterId: true, status: true, halfDay: true },
    }),
    prisma.attendance.findMany({ where: { date: attendanceDate }, select: { userId: true, status: true, checkinAt: true } }),
    prisma.semester.findMany({ where: { startDate: { lte: new Date(+day + 86_400_000) }, endDate: { gte: new Date(+day - 86_400_000) } }, select: { id: true, startDate: true, endDate: true } }),
    holidaysOn(dateKey),
    getCheckinPolicy(),
  ]);
  const semesterIds = semesters.filter((s) => pickedDateKey(s.startDate) <= dateKey && dateKey <= pickedDateKey(s.endDate)).map((s) => s.id);
  const schedules = semesterIds.length
    ? await prisma.schedule.findMany({
        where: { dayOfWeek: weekday, semesterId: { in: semesterIds } },
        orderBy: { startTime: "asc" },
        select: { id: true, teacherId: true, startTime: true, endTime: true, room: { select: { name: true } }, course: { select: { code: true, name: true, gradeLevel: true } } },
      })
    : [];

  const leaveBy = new Map<string, { status: string; halfDay: string | null }>();
  for (const l of leaves) {
    const prev = leaveBy.get(l.requesterId);
    if (!prev || (prev.status !== "APPROVED" && l.status === "APPROVED")) leaveBy.set(l.requesterId, { status: l.status, halfDay: l.halfDay });
  }
  const attBy = new Map(attendance.map((a) => [a.userId, a]));
  const now = new Date();

  const out = new Map<string, { reason: AbsenceReason; halfDay: string | null }>();
  for (const t of teachers) {
    const leave = leaveBy.get(t.id);
    const att = attBy.get(t.id);
    if (leave) out.set(t.id, { reason: leave.status === "APPROVED" ? "LEAVE" : "LEAVE_PENDING", halfDay: leave.halfDay });
    else if (att?.status === "ABSENT") out.set(t.id, { reason: "ABSENT", halfDay: null });
    else if (isToday && !att?.checkinAt && att?.status !== "LEAVE" && !isHolidayFor(holidays, t.campusLocationId)) {
      const hours = workHoursForSite(t.campusLocation, policy);
      const late = new Date(+atTimeOfDay(attendanceDate, hours.start) + hours.graceMinutes * 60_000);
      if (now > late && schedules.some((s) => s.teacherId === t.id)) out.set(t.id, { reason: "NOT_CHECKED_IN", halfDay: null });
    }
  }
  for (const id of manualIds) if (!out.has(id) && teachers.some((t) => t.id === id)) out.set(id, { reason: "MANUAL", halfDay: null });

  const sitesOf = (t: (typeof teachers)[number]) => new Set([t.campusLocationId, ...t.extraSites.map((x) => x.locationId)].filter(Boolean) as string[]);
  const byTeacher = new Map<string, typeof schedules>();
  for (const s of schedules) byTeacher.set(s.teacherId, [...(byTeacher.get(s.teacherId) ?? []), s]);

  const absent: AbsentTeacher[] = [];
  for (const t of teachers) {
    const o = out.get(t.id);
    if (!o) continue;
    const mySites = sitesOf(t);
    const slots: Slot[] = (byTeacher.get(t.id) ?? [])
      // Half-day leave: only the classes in that half need cover.
      .filter((s) => (o.halfDay === "AM" ? s.startTime < "12:00" : o.halfDay === "PM" ? s.endTime > "12:00" : true))
      .map((s) => {
        const level = s.course.gradeLevel;
        const candidates: Candidate[] = teachers
          .filter((c) => c.id !== t.id && !out.has(c.id))
          .filter((c) => mySites.size === 0 || Array.from(sitesOf(c)).some((x) => mySites.has(x)))
          .filter((c) => !(byTeacher.get(c.id) ?? []).some((own) => overlaps(own.startTime, own.endTime, s.startTime, s.endTime)))
          .map((c) => ({ id: c.id, name: c.name, classesToday: (byTeacher.get(c.id) ?? []).length, gradeMatch: !!level && c.gradeLevels.includes(level) }))
          .filter((c) => !level || c.gradeMatch)
          .sort((a, b) => a.classesToday - b.classesToday || a.name.localeCompare(b.name, "th"));
        return {
          scheduleId: s.id,
          start: s.startTime,
          end: s.endTime,
          courseCode: s.course.code,
          courseName: s.course.name,
          gradeLevel: level,
          room: s.room.name,
          candidates,
        };
      });
    absent.push({ id: t.id, name: t.name, siteName: t.campusLocation?.name ?? null, reason: o.reason, halfDay: o.halfDay, gradeLevels: t.gradeLevels, slots });
  }
  absent.sort((a, b) => b.slots.length - a.slots.length || a.name.localeCompare(b.name, "th"));

  return {
    absent,
    teachers: teachers.map((t) => ({ id: t.id, name: t.name, siteName: t.campusLocation?.name ?? null, gradeLevels: t.gradeLevels })),
    holidayAll: holidays.all,
    noSemester: semesterIds.length === 0,
  };
}
