"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { notifyUser } from "@/lib/notify";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

/**
 * FR-3.2 / FR-15: create a schedule slot, rejecting a teacher/room double-booking.
 * Times are free-form ("HH:MM", like a real calendar) rather than fixed period
 * slots, so the conflict check compares actual time ranges for overlap instead
 * of an exact period match.
 * Admin can create a slot for any teacher; a member (teacher) can only add to
 * their own schedule — the submitted teacherId is ignored and forced to their
 * own id so a member can never book time for someone else.
 */
export async function createSchedule(formData: FormData) {
  const session = await requireSession();
  const dict = getDictionary(getLocale());
  const isAdmin = session.user.role === "ADMIN";

  const teacherId = isAdmin ? (formData.get("teacherId") as string) : session.user.id;
  const courseId = formData.get("courseId") as string;
  const roomId = formData.get("roomId") as string;
  const semesterId = formData.get("semesterId") as string;
  const dayOfWeek = Number(formData.get("dayOfWeek"));
  const startTime = formData.get("startTime") as string;
  const endTime = formData.get("endTime") as string;
  const note = ((formData.get("note") as string) || "").trim() || null;

  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    return { ok: false, message: dict.actions.schedule.invalidTime };
  }
  if (endTime <= startTime) {
    return { ok: false, message: dict.actions.schedule.endBeforeStart };
  }

  // A room at another site than the teacher's own can't be used (client
  // request) — rooms with no site yet are allowed for everyone. A teacher
  // with NO assigned site yet can't be checked either way — rather than
  // silently skip the check (which let a room get booked at the wrong
  // campus with no signal to Admin), warn so it gets a manual look.
  const [teacher, room, semester] = await Promise.all([
    prisma.user.findUnique({ where: { id: teacherId }, select: { campusLocationId: true } }),
    prisma.room.findUnique({ where: { id: roomId }, select: { campusLocationId: true, campusLocation: { select: { name: true } } } }),
    prisma.semester.findUnique({ where: { id: semesterId }, select: { id: true, name: true, startDate: true, endDate: true } }),
  ]);
  if (!teacher || !room || !semester) return { ok: false, message: dict.actions.schedule.notFound };
  if (room.campusLocationId && teacher.campusLocationId && room.campusLocationId !== teacher.campusLocationId) {
    return { ok: false, message: dict.actions.schedule.roomOtherSite(room.campusLocation?.name ?? "-") };
  }
  const teacherNoSiteWarning =
    room.campusLocationId && !teacher.campusLocationId ? dict.actions.schedule.teacherNoSiteWarning(room.campusLocation?.name ?? "-") : null;

  // Two ranges [s1,e1) and [s2,e2) overlap iff s1 < e2 && s2 < e1 — "HH:MM"
  // strings compare correctly as plain strings since they're zero-padded.
  // A weekly slot repeats for as long as its semester runs, so a conflict
  // isn't limited to slots in the SAME semester record — two semesters
  // whose date ranges overlap (e.g. a short remedial term inside a regular
  // term) would otherwise let the same teacher/room get double-booked with
  // no warning at all, because each check only ever looked at its own
  // semesterId.
  const overlappingSemesters = await prisma.semester.findMany({
    where: { startDate: { lte: semester.endDate }, endDate: { gte: semester.startDate } },
    select: { id: true },
  });
  const semesterIds = overlappingSemesters.map((s) => s.id);
  const sameDay = await prisma.schedule.findMany({
    where: { semesterId: { in: semesterIds }, dayOfWeek, OR: [{ teacherId }, { roomId }] },
    include: { teacher: true, room: true, semester: true },
  });
  const conflict = sameDay.find((s) => startTime < s.endTime && s.startTime < endTime);
  if (conflict) {
    const sameSemester = conflict.semesterId === semesterId;
    const who =
      conflict.teacherId === teacherId
        ? sameSemester
          ? dict.actions.schedule.conflictWhoTeacher(conflict.teacher!.name)
          : dict.actions.schedule.conflictWhoTeacherSemester(conflict.teacher!.name, conflict.semester!.name)
        : sameSemester
          ? dict.actions.schedule.conflictWhoRoom(conflict.room!.name)
          : dict.actions.schedule.conflictWhoRoomSemester(conflict.room!.name, conflict.semester!.name);
    return { ok: false, message: dict.actions.schedule.conflict(who, conflict.startTime, conflict.endTime) };
  }

  const created = await prisma.schedule.create({
    data: { teacherId, courseId, roomId, semesterId, dayOfWeek, startTime, endTime, note },
    include: { course: true, room: true, semester: true },
  });

  // Admin put a class on someone else's timetable — let that teacher know.
  if (isAdmin && teacherId !== session.user.id) {
    await notifyUser(
      teacherId,
      "SCHEDULE_ASSIGNED",
      { courseCode: created.course!.code, courseName: created.course!.name, roomName: created.room!.name, semesterName: created.semester!.name, dayOfWeek, startTime, endTime },
      "/schedule"
    );
  }

  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  return { ok: true, message: teacherNoSiteWarning ? `${dict.actions.schedule.created} ${teacherNoSiteWarning}` : dict.actions.schedule.created };
}

/** Admin can edit any schedule's note; a member can only edit their own. */
export async function updateScheduleNote(id: string, note: string): Promise<{ ok: boolean; message: string }> {
  const session = await requireSession();
  const dict = getDictionary(getLocale());
  const isAdmin = session.user.role === "ADMIN";

  const schedule = await prisma.schedule.findUnique({ where: { id } });
  if (!schedule) return { ok: false, message: dict.actions.schedule.notFound };
  if (!isAdmin && schedule.teacherId !== session.user.id) {
    return { ok: false, message: dict.actions.schedule.noteUnauthorized };
  }

  await prisma.schedule.update({ where: { id }, data: { note: note.trim() || null } });
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  return { ok: true, message: dict.actions.schedule.noteSaved };
}

/** Admin can delete any schedule slot; a member can only delete their own. */
export async function deleteSchedule(id: string): Promise<{ ok: boolean; message: string }> {
  const session = await requireSession();
  const dict = getDictionary(getLocale());
  const isAdmin = session.user.role === "ADMIN";

  if (!isAdmin) {
    const schedule = await prisma.schedule.findUnique({ where: { id } });
    if (!schedule || schedule.teacherId !== session.user.id) {
      return { ok: false, message: dict.actions.schedule.deleteUnauthorized };
    }
  }

  const removed = await prisma.schedule.delete({ where: { id }, include: { course: true, semester: true } });
  if (isAdmin && removed.teacherId !== session.user.id) {
    await notifyUser(
      removed.teacherId,
      "SCHEDULE_REMOVED",
      { courseCode: removed.course!.code, semesterName: removed.semester!.name, dayOfWeek: removed.dayOfWeek, startTime: removed.startTime, endTime: removed.endTime },
      "/schedule"
    );
  }
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  return { ok: true, message: dict.actions.schedule.deleted };
}
