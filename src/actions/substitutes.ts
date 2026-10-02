"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { parseGradeLevels } from "@/lib/grades";
import { DATE_KEY_RE, keyToDate } from "@/lib/calendar";
import { bangkokDateKey } from "@/lib/date";
import { notifyUser } from "@/lib/notify";
import { overlaps, semestersOn } from "@/lib/substitutes";
import { weekdayOfKey } from "@/lib/workdays";

type ActionResult = { ok: boolean; message: string };

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

/** Admin sets which grade bands a teacher can teach (used to match substitutes). */
export async function updateUserGradeLevels(userId: string, levels: string[]): Promise<ActionResult> {
  await requireAdmin();
  const dict = getDictionary(getLocale());
  const gradeLevels = parseGradeLevels(Array.isArray(levels) ? levels : []);
  const res = await prisma.user.updateMany({ where: { id: userId }, data: { gradeLevels } });
  if (res.count === 0) return { ok: false, message: dict.actions.users.notFound };
  revalidatePath("/substitutes");
  return { ok: true, message: dict.substitutes.gradesSaved };
}

/**
 * Book `substituteId` to cover one class on one date (replacing any earlier
 * booking for that class). Re-checks on the server everything the planner
 * showed, since the page may be stale: the class really is on that weekday
 * in a semester covering the date, the substitute is an active teacher who
 * isn't the class's own teacher, isn't on leave that day, and has no class
 * or other booking overlapping it.
 */
export async function assignSubstitute(dateKey: string, scheduleId: string, substituteId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const t = getDictionary(getLocale()).actions.substitutes;
  if (!DATE_KEY_RE.test(dateKey)) return { ok: false, message: t.invalid };
  const day = keyToDate(dateKey);

  const [schedule, sub, semesterIds] = await Promise.all([
    prisma.schedule.findUnique({
      where: { id: scheduleId },
      select: { id: true, teacherId: true, dayOfWeek: true, semesterId: true, startTime: true, endTime: true, teacher: { select: { name: true } }, course: { select: { code: true, name: true } }, room: { select: { name: true } } },
    }),
    prisma.user.findUnique({ where: { id: substituteId }, select: { id: true, name: true, role: true, isActive: true } }),
    semestersOn(dateKey),
  ]);
  if (!schedule || schedule.dayOfWeek !== weekdayOfKey(dateKey) || !semesterIds.includes(schedule.semesterId)) return { ok: false, message: t.invalid };
  if (!sub || !sub.isActive || sub.role !== "MEMBER" || sub.id === schedule.teacherId) return { ok: false, message: t.badSubstitute };

  const [leave, ownClasses, bookings] = await Promise.all([
    prisma.leaveRequest.findFirst({ where: { requesterId: sub.id, status: { in: ["APPROVED", "PENDING"] }, startDate: { lte: day }, endDate: { gte: day } }, select: { id: true } }),
    prisma.schedule.findMany({ where: { teacherId: sub.id, dayOfWeek: schedule.dayOfWeek, semesterId: { in: semesterIds } }, select: { startTime: true, endTime: true } }),
    prisma.substituteAssignment.findMany({ where: { substituteId: sub.id, date: day, NOT: { scheduleId } }, select: { schedule: { select: { startTime: true, endTime: true } } } }),
  ]);
  if (leave) return { ok: false, message: t.onLeave(sub.name) };
  const clash = [...ownClasses, ...bookings.map((b) => b.schedule)].some((x) => overlaps(x.startTime, x.endTime, schedule.startTime, schedule.endTime));
  if (clash) return { ok: false, message: t.busy(sub.name) };

  const previous = await prisma.substituteAssignment.findUnique({ where: { date_scheduleId: { date: day, scheduleId } }, select: { substituteId: true } });
  if (previous?.substituteId === sub.id) return { ok: true, message: t.assigned(sub.name) };
  await prisma.substituteAssignment.upsert({
    where: { date_scheduleId: { date: day, scheduleId } },
    create: { date: day, scheduleId, absentTeacherId: schedule.teacherId, substituteId: sub.id, createdById: session.user.id },
    update: { substituteId: sub.id, absentTeacherId: schedule.teacherId, createdById: session.user.id },
  });

  // Tell the people involved — unless the day is already over (record keeping only).
  if (dateKey >= bangkokDateKey()) {
    const params = { date: dateKey, start: schedule.startTime, end: schedule.endTime, courseCode: schedule.course.code, courseName: schedule.course.name, room: schedule.room.name, absentName: schedule.teacher.name, substituteName: sub.name };
    if (previous) await notifyUser(previous.substituteId, "SUBSTITUTE_CANCELLED", params, "/dashboard");
    await notifyUser(sub.id, "SUBSTITUTE_ASSIGNED", params, "/dashboard");
    await notifyUser(schedule.teacherId, "SUBSTITUTE_COVERED", params, "/dashboard");
  }
  revalidatePath("/substitutes");
  revalidatePath("/dashboard");
  return { ok: true, message: t.assigned(sub.name) };
}

export async function cancelSubstitute(id: string): Promise<ActionResult> {
  await requireAdmin();
  const t = getDictionary(getLocale()).actions.substitutes;
  const row = await prisma.substituteAssignment.findUnique({
    where: { id },
    select: { date: true, substituteId: true, substitute: { select: { name: true } }, schedule: { select: { startTime: true, endTime: true, room: { select: { name: true } }, course: { select: { code: true, name: true } }, teacher: { select: { name: true } } } } },
  });
  if (!row) return { ok: false, message: t.notFound };
  await prisma.substituteAssignment.delete({ where: { id } });
  const dateKey = row.date.toISOString().slice(0, 10);
  if (dateKey >= bangkokDateKey()) {
    await notifyUser(row.substituteId, "SUBSTITUTE_CANCELLED", {
      date: dateKey, start: row.schedule.startTime, end: row.schedule.endTime, courseCode: row.schedule.course.code, courseName: row.schedule.course.name,
      room: row.schedule.room.name, absentName: row.schedule.teacher.name, substituteName: row.substitute.name,
    }, "/dashboard");
  }
  revalidatePath("/substitutes");
  revalidatePath("/dashboard");
  return { ok: true, message: t.cancelled };
}
