"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { parseGradeLevels } from "@/lib/grades";
import { isDateKey, keyToDate } from "@/lib/calendar";
import { bangkokDateKey } from "@/lib/date";
import { notifyUser } from "@/lib/notify";
import { semestersOn, substituteEligibility } from "@/lib/substitutes";
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
 * booking for that class). The page may be stale, so the server re-runs the
 * planner's own eligibility rules (substituteEligibility) — whoever the
 * planner offers can be booked, nobody else.
 */
export async function assignSubstitute(dateKey: string, scheduleId: string, substituteId: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const t = getDictionary(getLocale()).actions.substitutes;
  if (!isDateKey(dateKey)) return { ok: false, message: t.invalid };
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

  const verdict = await substituteEligibility(dateKey, scheduleId, sub.id, schedule.teacherId);
  if (!verdict.ok) {
    if (verdict.reason === "NO_SLOT") return { ok: false, message: t.invalid };
    if (verdict.reason === "AWAY") return { ok: false, message: t.onLeave(sub.name) };
    if (verdict.reason === "OWN_CLASS" || verdict.reason === "COVERING") return { ok: false, message: t.busy(sub.name) };
    return { ok: false, message: t.badSubstitute };
  }

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
    select: { date: true, substituteId: true, substitute: { select: { name: true } }, schedule: { select: { teacherId: true, startTime: true, endTime: true, room: { select: { name: true } }, course: { select: { code: true, name: true } }, teacher: { select: { name: true } } } } },
  });
  if (!row) return { ok: false, message: t.notFound };
  await prisma.substituteAssignment.delete({ where: { id } });
  const dateKey = row.date.toISOString().slice(0, 10);
  if (dateKey >= bangkokDateKey()) {
    const params = {
      date: dateKey, start: row.schedule.startTime, end: row.schedule.endTime, courseCode: row.schedule.course.code, courseName: row.schedule.course.name,
      room: row.schedule.room.name, absentName: row.schedule.teacher.name, substituteName: row.substitute.name,
    };
    await notifyUser(row.substituteId, "SUBSTITUTE_CANCELLED", params, "/dashboard");
    // The class's own teacher was told someone covers it — tell them it's uncovered again.
    await notifyUser(row.schedule.teacherId, "SUBSTITUTE_UNCOVERED", params, "/dashboard");
  }
  revalidatePath("/substitutes");
  revalidatePath("/dashboard");
  return { ok: true, message: t.cancelled };
}
