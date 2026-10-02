import type { GradeLevel } from "@prisma/client";
import { prisma } from "./prisma";
import { keyToDate } from "./calendar";
import { bangkokDateKey, pickedDateKey } from "./date";
import { getCheckinPolicy, lateCutoff, workHoursForSite } from "./settings";
import { holidayFor, isWorkday, loadWorkCalendar, weekdayOfKey } from "./workdays";
import { attendanceDateOf } from "./absence";

/**
 * Substitute-teacher planning ("หาครูสอนแทน") for one day:
 *   1. who is out — leave (approved or pending) covering the day, marked
 *      ABSENT, or (today only) not checked in after their late cut-off —
 *      plus anyone the Admin adds by hand or who already has a substitute
 *      booked that day;
 *   2. each one's classes that weekday in the semester covering the day
 *      (none on a holiday / non-work day at their school; a half-day leave
 *      only needs the classes in that half);
 *   3. for each class, teachers who are free then: same school, not out
 *      themselves, no class of their own and no other substitute booking
 *      overlapping it, and teaching the course's grade band (when the course
 *      has one) — least busy first;
 *   4. the booking already made for the class, if any (and whether that
 *      substitute has since become unavailable).
 */

export type AbsenceReason = "LEAVE" | "LEAVE_PENDING" | "ABSENT" | "NOT_CHECKED_IN" | "MANUAL" | "BOOKED";

export type Candidate = { id: string; name: string; classesToday: number; gradeMatch: boolean };
export type Booking = { id: string; substituteId: string; name: string; unavailable: boolean };
export type Slot = {
  scheduleId: string;
  start: string;
  end: string;
  courseCode: string;
  courseName: string;
  gradeLevel: GradeLevel | null;
  room: string;
  booking: Booking | null;
  candidates: Candidate[];
};
export type AbsentTeacher = {
  id: string;
  name: string;
  siteName: string | null;
  reason: AbsenceReason;
  halfDay: string | null;
  gradeLevels: GradeLevel[];
  dayOff: boolean;
  slots: Slot[];
};

export const overlaps = (a1: string, a2: string, b1: string, b2: string) => a1 < b2 && b1 < a2;

/** Ids of semesters whose date range contains the day. */
export async function semestersOn(dateKey: string) {
  const day = keyToDate(dateKey);
  const rows = await prisma.semester.findMany({
    where: { startDate: { lte: new Date(+day + 86_400_000) }, endDate: { gte: new Date(+day - 86_400_000) } },
    select: { id: true, startDate: true, endDate: true },
  });
  return rows.filter((s) => pickedDateKey(s.startDate) <= dateKey && dateKey <= pickedDateKey(s.endDate)).map((s) => s.id);
}

export async function buildSubstitutePlan(dateKey: string, manualIds: string[] = []) {
  const day = keyToDate(dateKey); // picked-date convention (leave, semesters, bookings)
  const attendanceDate = attendanceDateOf(dateKey); // Bangkok-midnight convention (Attendance.date)
  const weekday = weekdayOfKey(dateKey);
  const isToday = dateKey === bangkokDateKey();

  const [teachers, leaves, attendance, semesterIds, cal, policy, bookings] = await Promise.all([
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
    semestersOn(dateKey),
    loadWorkCalendar(dateKey, dateKey),
    getCheckinPolicy(),
    prisma.substituteAssignment.findMany({
      where: { date: day },
      select: { id: true, scheduleId: true, absentTeacherId: true, substituteId: true, schedule: { select: { startTime: true, endTime: true } } },
    }),
  ]);
  const schedules = semesterIds.length
    ? await prisma.schedule.findMany({
        where: { dayOfWeek: weekday, semesterId: { in: semesterIds } },
        orderBy: { startTime: "asc" },
        select: { id: true, teacherId: true, startTime: true, endTime: true, room: { select: { name: true } }, course: { select: { code: true, name: true, gradeLevel: true } } },
      })
    : [];

  // Approved leave wins over a pending one when someone has both.
  const leaveBy = new Map<string, { status: string; halfDay: string | null }>();
  for (const l of leaves) {
    const prev = leaveBy.get(l.requesterId);
    if (!prev || (prev.status !== "APPROVED" && l.status === "APPROVED")) leaveBy.set(l.requesterId, { status: l.status, halfDay: l.halfDay });
  }
  const attBy = new Map(attendance.map((a) => [a.userId, a]));
  const byTeacher = new Map<string, typeof schedules>();
  for (const s of schedules) byTeacher.set(s.teacherId, [...(byTeacher.get(s.teacherId) ?? []), s]);
  const now = new Date();

  const out = new Map<string, { reason: AbsenceReason; halfDay: string | null }>();
  for (const t of teachers) {
    const leave = leaveBy.get(t.id);
    const att = attBy.get(t.id);
    if (att?.checkinAt && !leave?.halfDay) continue; // here today
    if (leave) out.set(t.id, { reason: leave.status === "APPROVED" ? "LEAVE" : "LEAVE_PENDING", halfDay: leave.halfDay });
    else if (att?.status === "ABSENT") out.set(t.id, { reason: "ABSENT", halfDay: null });
    else if (att?.status === "LEAVE") out.set(t.id, { reason: "LEAVE", halfDay: null });
    else if (isToday && !att?.checkinAt && isWorkday(cal, dateKey, t.campusLocationId) && byTeacher.has(t.id)) {
      const hours = workHoursForSite(t.campusLocation, policy);
      if (now > lateCutoff(attendanceDate, hours, null, policy)) out.set(t.id, { reason: "NOT_CHECKED_IN", halfDay: null });
    }
  }
  for (const id of manualIds) if (!out.has(id) && teachers.some((t) => t.id === id)) out.set(id, { reason: "MANUAL", halfDay: null });
  for (const b of bookings) if (!out.has(b.absentTeacherId) && teachers.some((t) => t.id === b.absentTeacherId)) out.set(b.absentTeacherId, { reason: "BOOKED", halfDay: null });

  const nameOf = new Map(teachers.map((t) => [t.id, t.name]));
  const sitesOf = (t: (typeof teachers)[number]) => new Set([t.campusLocationId, ...t.extraSites.map((x) => x.locationId)].filter(Boolean) as string[]);
  const bookingsBy = new Map<string, typeof bookings>();
  for (const b of bookings) bookingsBy.set(b.substituteId, [...(bookingsBy.get(b.substituteId) ?? []), b]);
  /** Own classes + substitute bookings, excluding the booking for `exceptSchedule`. */
  const busy = (teacherId: string, exceptSchedule: string) => [
    ...(byTeacher.get(teacherId) ?? []).map((s) => ({ start: s.startTime, end: s.endTime })),
    ...(bookingsBy.get(teacherId) ?? []).filter((b) => b.scheduleId !== exceptSchedule).map((b) => ({ start: b.schedule.startTime, end: b.schedule.endTime })),
  ];

  const absent: AbsentTeacher[] = [];
  for (const t of teachers) {
    const o = out.get(t.id);
    if (!o) continue;
    const dayOff = !isWorkday(cal, dateKey, t.campusLocationId);
    const mySites = sitesOf(t);
    const slots: Slot[] = (dayOff ? [] : byTeacher.get(t.id) ?? [])
      // Half-day leave: only the classes in that half need cover.
      .filter((s) => (o.halfDay === "AM" ? s.startTime < policy.afternoonStart : o.halfDay === "PM" ? s.endTime > policy.afternoonStart : true))
      .map((s) => {
        const level = s.course.gradeLevel;
        const b = bookings.find((x) => x.scheduleId === s.id);
        const candidates: Candidate[] = teachers
          .filter((c) => c.id !== t.id && !out.has(c.id))
          .filter((c) => mySites.size === 0 || Array.from(sitesOf(c)).some((x) => mySites.has(x)))
          .filter((c) => isWorkday(cal, dateKey, c.campusLocationId))
          .filter((c) => !busy(c.id, s.id).some((x) => overlaps(x.start, x.end, s.startTime, s.endTime)))
          .map((c) => ({ id: c.id, name: c.name, classesToday: busy(c.id, "").length, gradeMatch: !!level && c.gradeLevels.includes(level) }))
          .filter((c) => !level || c.gradeMatch)
          .sort((a, b2) => a.classesToday - b2.classesToday || a.name.localeCompare(b2.name, "th"));
        return {
          scheduleId: s.id,
          start: s.startTime,
          end: s.endTime,
          courseCode: s.course.code,
          courseName: s.course.name,
          gradeLevel: level,
          room: s.room.name,
          booking: b ? { id: b.id, substituteId: b.substituteId, name: nameOf.get(b.substituteId) ?? "—", unavailable: out.has(b.substituteId) || !nameOf.has(b.substituteId) } : null,
          candidates,
        };
      });
    absent.push({ id: t.id, name: t.name, siteName: t.campusLocation?.name ?? null, reason: o.reason, halfDay: o.halfDay, gradeLevels: t.gradeLevels, dayOff, slots });
  }
  // Most uncovered classes first.
  const open = (a: AbsentTeacher) => a.slots.filter((s) => !s.booking || s.booking.unavailable).length;
  absent.sort((a, b) => open(b) - open(a) || b.slots.length - a.slots.length || a.name.localeCompare(b.name, "th"));

  return {
    absent,
    teachers: teachers.map((t) => ({ id: t.id, name: t.name, siteName: t.campusLocation?.name ?? null, gradeLevels: t.gradeLevels })),
    holiday: holidayFor(cal, dateKey, null)?.title ?? null,
    weekend: !cal.weekdays.has(weekday),
    noSemester: semesterIds.length === 0,
  };
}
