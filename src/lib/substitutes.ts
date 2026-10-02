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
 *      has one). Ranked: already checked in → fewest classes that day →
 *      same department. Today, someone who hasn't checked in yet but isn't
 *      late either is still offered, flagged `waiting` and ranked last;
 *      everyone left out comes with the reason (`excluded`);
 *   4. the booking already made for the class, if any (and whether that
 *      substitute has since become unavailable).
 *
 * buildSubstituteBoard adds the whole-school view the planner page draws:
 * every teacher of one school × the day's class times, so an Admin can see
 * who teaches, who is free and who already covers what.
 */

export type AbsenceReason = "LEAVE" | "LEAVE_PENDING" | "ABSENT" | "NOT_CHECKED_IN" | "MANUAL" | "BOOKED";
export type ExcludeReason = "AWAY" | "DAY_OFF" | "OWN_CLASS" | "COVERING" | "GRADE";

export type Candidate = {
  id: string;
  name: string;
  classesToday: number;
  gradeMatch: boolean;
  /** Today only: not checked in yet, but not late yet either. */
  waiting: boolean;
  /** "HH:MM" check-in time today, if any. */
  checkinAt: string | null;
  late: boolean;
  sameDept: boolean;
};
export type Excluded = { id: string; name: string; reason: ExcludeReason; detail: string | null };
export type Booking = { id: string; substituteId: string; name: string; unavailable: boolean };
export type Slot = {
  scheduleId: string;
  start: string;
  end: string;
  courseCode: string;
  courseName: string;
  gradeLevel: GradeLevel | null;
  room: string;
  ownerId: string;
  ownerName: string;
  /** School the class takes place at: the room's site, else the teacher's primary site. */
  siteId: string | null;
  booking: Booking | null;
  candidates: Candidate[];
  excluded: Excluded[];
};
export type AbsentTeacher = {
  id: string;
  name: string;
  siteId: string | null;
  siteName: string | null;
  reason: AbsenceReason;
  halfDay: string | null;
  gradeLevels: GradeLevel[];
  dayOff: boolean;
  slots: Slot[];
};

export const overlaps = (a1: string, a2: string, b1: string, b2: string) => a1 < b2 && b1 < a2;
const hm = (d: Date) => new Date(+d + 7 * 3_600_000).toISOString().slice(11, 16); // Bangkok "HH:MM"

/** Ids of semesters whose date range contains the day. */
export async function semestersOn(dateKey: string) {
  const day = keyToDate(dateKey);
  const rows = await prisma.semester.findMany({
    where: { startDate: { lte: new Date(+day + 86_400_000) }, endDate: { gte: new Date(+day - 86_400_000) } },
    select: { id: true, startDate: true, endDate: true },
  });
  return rows.filter((s) => pickedDateKey(s.startDate) <= dateKey && dateKey <= pickedDateKey(s.endDate)).map((s) => s.id);
}

async function computePlan(dateKey: string, manualIds: string[] = []) {
  const day = keyToDate(dateKey); // picked-date convention (leave, semesters, bookings)
  const attendanceDate = attendanceDateOf(dateKey); // Bangkok-midnight convention (Attendance.date)
  const weekday = weekdayOfKey(dateKey);
  const isToday = dateKey === bangkokDateKey();

  const [teachers, leaves, attendance, semesterIds, cal, policy, bookingRows] = await Promise.all([
    prisma.user.findMany({
      where: { role: "MEMBER", isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, gradeLevels: true, campusLocationId: true, departmentId: true,
        department: { select: { name: true } },
        campusLocation: { select: { name: true, workStart: true, workEnd: true, lateGraceMinutes: true } },
        extraSites: { select: { locationId: true } },
      },
    }),
    prisma.leaveRequest.findMany({
      where: { status: { in: ["APPROVED", "PENDING"] }, startDate: { lte: day }, endDate: { gte: day } },
      select: { requesterId: true, status: true, halfDay: true, type: true },
    }),
    prisma.attendance.findMany({ where: { date: attendanceDate }, select: { userId: true, status: true, checkinAt: true } }),
    semestersOn(dateKey),
    loadWorkCalendar(dateKey, dateKey),
    getCheckinPolicy(),
    // Only bookings whose class still runs that day (a semester edit can leave stale ones behind).
    prisma.substituteAssignment.findMany({
      where: { date: day, schedule: { dayOfWeek: weekday, semester: { startDate: { lte: new Date(+day + 86_400_000) }, endDate: { gte: new Date(+day - 86_400_000) } } } },
      select: { id: true, scheduleId: true, absentTeacherId: true, substituteId: true, schedule: { select: { semesterId: true, startTime: true, endTime: true, course: { select: { code: true } } } } },
    }),
  ]);
  // The query's ±1 day window is coarse — keep only bookings whose semester really covers the day.
  const bookings = bookingRows.filter((b) => semesterIds.includes(b.schedule.semesterId));
  const schedules = semesterIds.length
    ? await prisma.schedule.findMany({
        where: { dayOfWeek: weekday, semesterId: { in: semesterIds } },
        orderBy: { startTime: "asc" },
        select: { id: true, teacherId: true, startTime: true, endTime: true, room: { select: { name: true, campusLocationId: true } }, course: { select: { code: true, name: true, gradeLevel: true } } },
      })
    : [];

  // Approved leave wins over a pending one when someone has both.
  const leaveBy = new Map<string, { status: string; halfDay: string | null; type: string }>();
  for (const l of leaves) {
    const prev = leaveBy.get(l.requesterId);
    if (!prev || (prev.status !== "APPROVED" && l.status === "APPROVED")) leaveBy.set(l.requesterId, { status: l.status, halfDay: l.halfDay, type: l.type });
  }
  const attBy = new Map(attendance.map((a) => [a.userId, a]));
  const byTeacher = new Map<string, typeof schedules>();
  for (const s of schedules) byTeacher.set(s.teacherId, [...(byTeacher.get(s.teacherId) ?? []), s]);
  const now = new Date();
  /** Late cut-off today; on a morning half-day leave the afternoon start + grace. */
  const cutoffOf = (t: (typeof teachers)[number]) =>
    lateCutoff(attendanceDate, workHoursForSite(t.campusLocation, policy), leaveBy.get(t.id)?.halfDay === "AM" ? "AM" : null, policy);
  /**
   * Off that day: a school-calendar holiday at their school, or a non-work
   * weekday — unless they teach a class that day (weekend make-up classes).
   */
  const offFor = (t: (typeof teachers)[number]) =>
    !!holidayFor(cal, dateKey, t.campusLocationId) || (!cal.weekdays.has(weekday) && !byTeacher.has(t.id));
  /** Today, due at work, still no check-in after their cut-off. */
  const noShow = (t: (typeof teachers)[number]) => isToday && !attBy.get(t.id)?.checkinAt && !offFor(t) && now > cutoffOf(t);

  const out = new Map<string, { reason: AbsenceReason; halfDay: string | null }>();
  for (const t of teachers) {
    const leave = leaveBy.get(t.id);
    const att = attBy.get(t.id);
    if (att?.checkinAt && !leave?.halfDay) continue; // here today
    if (leave) {
      // A half-day leave whose other half was missed too (no check-in past the cut-off) = away all day.
      const missedOtherHalf = !!leave.halfDay && noShow(t);
      out.set(t.id, { reason: leave.status === "APPROVED" ? "LEAVE" : "LEAVE_PENDING", halfDay: missedOtherHalf ? null : leave.halfDay });
    } else if (att?.status === "ABSENT") out.set(t.id, { reason: "ABSENT", halfDay: null });
    else if (att?.status === "LEAVE") out.set(t.id, { reason: "LEAVE", halfDay: null });
    else if (noShow(t) && byTeacher.has(t.id)) out.set(t.id, { reason: "NOT_CHECKED_IN", halfDay: null });
  }
  for (const id of manualIds) if (!out.has(id) && teachers.some((t) => t.id === id)) out.set(id, { reason: "MANUAL", halfDay: null });
  for (const b of bookings) if (!out.has(b.absentTeacherId) && teachers.some((t) => t.id === b.absentTeacherId)) out.set(b.absentTeacherId, { reason: "BOOKED", halfDay: null });

  /** Away during start–end: out all day, or the half of a half-day leave that overlaps. BOOKED isn't away by itself. */
  const awayAt = (id: string, start: string, end: string) => {
    const o = out.get(id);
    if (!o || o.reason === "BOOKED") return false;
    if (o.halfDay === "AM") return start < policy.afternoonStart;
    if (o.halfDay === "PM") return end > policy.afternoonStart;
    return true;
  };
  /** Today: not checked in yet but not late yet (could still turn up). */
  const waiting = (t: (typeof teachers)[number]) => isToday && !attBy.get(t.id)?.checkinAt && !offFor(t) && now <= cutoffOf(t);

  const nameOf = new Map(teachers.map((t) => [t.id, t.name]));
  const sitesOf = (t: (typeof teachers)[number]) => new Set([t.campusLocationId, ...t.extraSites.map((x) => x.locationId)].filter(Boolean) as string[]);
  const bookingsBy = new Map<string, typeof bookings>();
  for (const b of bookings) bookingsBy.set(b.substituteId, [...(bookingsBy.get(b.substituteId) ?? []), b]);

  const subUnavailable = (id: string, start: string, end: string) => {
    const sub = teachers.find((x) => x.id === id);
    return !sub || awayAt(id, start, end) || noShow(sub) || (byTeacher.get(id) ?? []).some((x) => overlaps(x.startTime, x.endTime, start, end));
  };

  const absent: AbsentTeacher[] = [];
  for (const t of teachers) {
    const o = out.get(t.id);
    if (!o) continue;
    const dayOff = offFor(t);
    const slots: Slot[] = (dayOff ? [] : byTeacher.get(t.id) ?? [])
      // Half-day leave: only the classes in that half need cover; a booking keeps its class listed.
      .filter((s) => awayAt(t.id, s.startTime, s.endTime) || bookings.some((b) => b.scheduleId === s.id))
      .map((s) => {
        const level = s.course.gradeLevel;
        const b = bookings.find((x) => x.scheduleId === s.id);
        const slotSite = s.room.campusLocationId ?? t.campusLocationId;
        const candidates: Candidate[] = [];
        const excluded: Excluded[] = [];
        for (const c of teachers) {
          if (c.id === t.id) continue;
          if (slotSite && !sitesOf(c).has(slotSite)) continue; // doesn't work at the class's school: not listed at all
          const reject = (reason: ExcludeReason, detail: string | null = null) => excluded.push({ id: c.id, name: c.name, reason, detail });
          if (awayAt(c.id, s.startTime, s.endTime)) { reject("AWAY"); continue; }
          if (offFor(c)) { reject("DAY_OFF"); continue; }
          // Today: hasn't turned up and is past their cut-off — not at school.
          if (noShow(c)) { reject("AWAY", "NOT_CHECKED_IN"); continue; }
          const own = (byTeacher.get(c.id) ?? []).find((x) => overlaps(x.startTime, x.endTime, s.startTime, s.endTime));
          if (own) { reject("OWN_CLASS", own.course.code); continue; }
          const cover = (bookingsBy.get(c.id) ?? []).find((x) => x.scheduleId !== s.id && overlaps(x.schedule.startTime, x.schedule.endTime, s.startTime, s.endTime));
          if (cover) { reject("COVERING", nameOf.get(cover.absentTeacherId) ?? null); continue; }
          const gradeMatch = !!level && c.gradeLevels.includes(level);
          if (level && !gradeMatch) { reject("GRADE", c.gradeLevels.join(",")); continue; }
          const att = attBy.get(c.id);
          candidates.push({
            id: c.id,
            name: c.name,
            classesToday: (byTeacher.get(c.id) ?? []).length + (bookingsBy.get(c.id) ?? []).filter((x) => x.scheduleId !== s.id).length,
            gradeMatch,
            waiting: waiting(c),
            checkinAt: att?.checkinAt ? hm(att.checkinAt) : null,
            late: att?.status === "LATE",
            sameDept: !!t.departmentId && c.departmentId === t.departmentId,
          });
        }
        candidates.sort(
          (a, b2) => Number(a.waiting) - Number(b2.waiting) || a.classesToday - b2.classesToday || Number(b2.sameDept) - Number(a.sameDept) || a.name.localeCompare(b2.name, "th")
        );
        return {
          scheduleId: s.id,
          start: s.startTime,
          end: s.endTime,
          courseCode: s.course.code,
          courseName: s.course.name,
          gradeLevel: level,
          room: s.room.name,
          ownerId: t.id,
          ownerName: t.name,
          siteId: slotSite,
          // The booked substitute can't do it any more: inactive, away / no-show, or now has a class of their own then.
          booking: b
            ? {
                id: b.id,
                substituteId: b.substituteId,
                name: nameOf.get(b.substituteId) ?? "—",
                unavailable: subUnavailable(b.substituteId, s.startTime, s.endTime),
              }
            : null,
          candidates,
          excluded,
        };
      });
    absent.push({ id: t.id, name: t.name, siteId: t.campusLocationId, siteName: t.campusLocation?.name ?? null, reason: o.reason, halfDay: o.halfDay, gradeLevels: t.gradeLevels, dayOff, slots });
  }
  // Most uncovered classes first.
  const open = (a: AbsentTeacher) => a.slots.filter((s) => !s.booking || s.booking.unavailable).length;
  absent.sort((a, b) => open(b) - open(a) || b.slots.length - a.slots.length || a.name.localeCompare(b.name, "th"));

  return {
    plan: {
      absent,
      teachers: teachers.map((t) => ({ id: t.id, name: t.name, siteName: t.campusLocation?.name ?? null, gradeLevels: t.gradeLevels })),
      holiday: holidayFor(cal, dateKey, null)?.title ?? null,
      weekend: !cal.weekdays.has(weekday),
      noSemester: semesterIds.length === 0,
    },
    raw: { teachers, out, awayAt, waiting, attBy, byTeacher, bookings, cal, cutoffOf, sitesOf, nameOf, offFor },
  };
}

export async function buildSubstitutePlan(dateKey: string, manualIds: string[] = []) {
  return (await computePlan(dateKey, manualIds)).plan;
}

export type Presence =
  | { kind: "IN"; at: string; late: boolean }
  | { kind: "WAITING"; until: string }
  | { kind: "OUT"; reason: AbsenceReason; halfDay: string | null }
  | { kind: "NONE" }; // no record (another day, or no classes today)

export type BoardCell =
  | { type: "need"; scheduleId: string; code: string; room: string }
  | { type: "covered"; scheduleId: string; code: string; room: string; by: string; unavailable: boolean }
  | { type: "class"; code: string; room: string }
  | { type: "busy" } // an own class or cover spanning this column without starting/ending with it
  | { type: "covering"; code: string; forName: string }
  | { type: "off" }
  | { type: "free" };
export type BoardRow = { id: string; name: string; department: string | null; gradeLevels: GradeLevel[]; extraSite: boolean; presence: Presence; openCount: number; cells: BoardCell[] };
export type BoardColumn = { start: string; end: string };

/**
 * One school's day for the planner page: who is out, every class that needs
 * cover (with ranked candidates), and the teacher × class-time grid.
 * `siteId` null = the school with the most uncovered classes (or the first).
 */
export async function buildSubstituteBoard(dateKey: string, siteId: string | null, manualIds: string[] = []) {
  const { plan, raw } = await computePlan(dateKey, manualIds);
  const sites = await prisma.campusLocation.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const inSite = (t: (typeof raw.teachers)[number], id: string) => raw.sitesOf(t).has(id);
  const allSlots = plan.absent.flatMap((a) => a.slots);
  const openSlots = (id: string) => allSlots.filter((s) => s.siteId === id && (!s.booking || s.booking.unavailable)).length;
  const siteList = sites.map((s) => ({ id: s.id, name: s.name, open: openSlots(s.id), teachers: raw.teachers.filter((t) => inSite(t, s.id)).length }));
  const chosen = (siteId && sites.find((s) => s.id === siteId)?.id) || [...siteList].sort((a, b) => b.open - a.open)[0]?.id || null;

  const slots = allSlots.filter((s) => s.siteId === chosen).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const slotById = new Map(slots.map((s) => [s.scheduleId, s]));
  const members = chosen ? raw.teachers.filter((t) => inSite(t, chosen)) : [];

  // Columns: the distinct class times taught at this school that day.
  const colKeys = new Set<string>();
  for (const t of members) for (const s of raw.byTeacher.get(t.id) ?? []) colKeys.add(`${s.startTime}|${s.endTime}`);
  const columns: BoardColumn[] = Array.from(colKeys).sort().map((k) => ({ start: k.split("|")[0], end: k.split("|")[1] }));

  const rows: BoardRow[] = members.map((t) => {
    const att = raw.attBy.get(t.id);
    const o = raw.out.get(t.id);
    const presence: Presence = o && o.reason !== "BOOKED"
      ? { kind: "OUT", reason: o.reason, halfDay: o.halfDay }
      : att?.checkinAt
        ? { kind: "IN", at: hm(att.checkinAt), late: att.status === "LATE" }
        : raw.waiting(t)
          ? { kind: "WAITING", until: hm(raw.cutoffOf(t)) }
          : { kind: "NONE" };
    const own = raw.byTeacher.get(t.id) ?? [];
    const covering = raw.bookings.filter((b) => b.substituteId === t.id);
    const cells: BoardCell[] = columns.map((c) => {
      const exact = own.find((s) => s.startTime === c.start && s.endTime === c.end);
      if (exact) {
        const slot = slotById.get(exact.id);
        if (slot?.booking) return { type: "covered", scheduleId: exact.id, code: exact.course.code, room: exact.room.name, by: slot.booking.name, unavailable: slot.booking.unavailable };
        if (slot) return { type: "need", scheduleId: exact.id, code: exact.course.code, room: exact.room.name };
        return { type: "class", code: exact.course.code, room: exact.room.name };
      }
      const cov = covering.find((b) => b.schedule.startTime === c.start && b.schedule.endTime === c.end);
      if (cov) return { type: "covering", code: cov.schedule.course.code, forName: raw.nameOf.get(cov.absentTeacherId) ?? "—" };
      if (raw.awayAt(t.id, c.start, c.end)) return { type: "off" };
      if (own.some((s) => overlaps(s.startTime, s.endTime, c.start, c.end)) || covering.some((b) => overlaps(b.schedule.startTime, b.schedule.endTime, c.start, c.end))) return { type: "busy" };
      return { type: "free" };
    });
    return {
      id: t.id,
      name: t.name,
      department: t.department?.name ?? null,
      gradeLevels: t.gradeLevels,
      extraSite: t.campusLocationId !== chosen,
      presence,
      openCount: cells.filter((x) => x.type === "need").length,
      cells,
    };
  });
  // Teachers who are out (or partly out) first, then everyone else by name.
  const rank = (r: BoardRow) => (r.presence.kind === "OUT" ? 0 : r.presence.kind === "WAITING" ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || b.openCount - a.openCount || a.name.localeCompare(b.name, "th"));

  return {
    ...plan,
    siteId: chosen,
    sites: siteList,
    slots,
    columns,
    rows,
    out: plan.absent.filter((a) => a.slots.some((s) => s.siteId === chosen) || (a.slots.length === 0 && a.siteId === chosen)),
    waiting: rows.filter((r) => r.presence.kind === "WAITING").map((r) => ({ id: r.id, name: r.name, until: (r.presence as { until: string }).until })),
    isToday: dateKey === bangkokDateKey(),
  };
}

/** Uncovered / covered class counts for each day (Mon–Fri around `dateKey`) at one school — the week strip. */
export async function substituteWeek(dateKey: string, siteId: string | null) {
  const wd = weekdayOfKey(dateKey);
  const monday = new Date(Date.parse(`${dateKey}T00:00:00Z`) - wd * 86_400_000);
  const days = Array.from({ length: 5 }, (_, i) => new Date(+monday + i * 86_400_000).toISOString().slice(0, 10));
  return Promise.all(
    days.map(async (key) => {
      const { plan } = await computePlan(key);
      const slots = plan.absent.flatMap((a) => a.slots).filter((s) => !siteId || s.siteId === siteId);
      const done = slots.filter((s) => s.booking && !s.booking.unavailable).length;
      return { key, need: slots.length, done, holiday: plan.holiday };
    })
  );
}

/**
 * Server-side check for a booking: may `substituteId` cover class
 * `scheduleId` on `dateKey`? Uses exactly the planner's rules (computePlan),
 * so the server never accepts someone the page wouldn't offer — nor refuses
 * someone it did (half-day leave, school, grade band, day off, no-show,
 * own class, other bookings).
 */
export async function substituteEligibility(dateKey: string, scheduleId: string, substituteId: string, ownerId: string) {
  let { plan } = await computePlan(dateKey);
  let slot = plan.absent.flatMap((a) => a.slots).find((s) => s.scheduleId === scheduleId);
  // The teacher may have been added by hand on the page (not out by any rule).
  if (!slot) {
    plan = (await computePlan(dateKey, [ownerId])).plan;
    slot = plan.absent.flatMap((a) => a.slots).find((s) => s.scheduleId === scheduleId);
  }
  if (!slot) return { ok: false as const, reason: "NO_SLOT" as const };
  if (slot.candidates.some((c) => c.id === substituteId)) return { ok: true as const };
  const ex = slot.excluded.find((e) => e.id === substituteId);
  return { ok: false as const, reason: ex?.reason ?? ("NOT_LISTED" as const) };
}
