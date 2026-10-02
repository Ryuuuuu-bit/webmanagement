"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { Dictionary } from "@/lib/i18n/dictionaries";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

function parseSemesterInput(formData: FormData) {
  const name = (formData.get("name") as string || "").trim();
  const startDate = new Date(formData.get("startDate") as string);
  const endDate = new Date(formData.get("endDate") as string);
  const dueRaw = ((formData.get("lessonPlanDueDate") as string) || "").trim();
  const lessonPlanDueDate = dueRaw ? new Date(dueRaw) : null;
  return { name, startDate, endDate, lessonPlanDueDate };
}

function validateSemesterInput(
  { name, startDate, endDate, lessonPlanDueDate }: ReturnType<typeof parseSemesterInput>,
  dict: Dictionary
) {
  if (!name) return dict.actions.semesters.fillRequired;
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return dict.actions.semesters.invalidDates;
  if (endDate < startDate) return dict.actions.semesters.endBeforeStart;
  if (lessonPlanDueDate && isNaN(lessonPlanDueDate.getTime())) return dict.actions.semesters.invalidDates;
  if (lessonPlanDueDate && lessonPlanDueDate > endDate) return dict.actions.semesters.dueAfterEnd;
  return null;
}

/** First teacher/room double-booking between semester `id` (with new dates) and any other semester those dates overlap. */
async function semesterClash(id: string, startDate: Date, endDate: Date) {
  const others = await prisma.semester.findMany({
    where: { id: { not: id }, startDate: { lte: endDate }, endDate: { gte: startDate } },
    select: { id: true },
  });
  if (others.length === 0) return null;
  const [mine, theirs] = await Promise.all([
    prisma.schedule.findMany({ where: { semesterId: id }, select: { teacherId: true, roomId: true, dayOfWeek: true, startTime: true, endTime: true, teacher: { select: { name: true } }, room: { select: { name: true } } } }),
    prisma.schedule.findMany({
      where: { semesterId: { in: others.map((o) => o.id) } },
      select: { teacherId: true, roomId: true, dayOfWeek: true, startTime: true, endTime: true, semester: { select: { name: true } } },
    }),
  ]);
  for (const a of mine) {
    const b = theirs.find((x) => x.dayOfWeek === a.dayOfWeek && (x.teacherId === a.teacherId || x.roomId === a.roomId) && a.startTime < x.endTime && x.startTime < a.endTime);
    if (b) return { who: b.teacherId === a.teacherId ? a.teacher.name : a.room.name, other: b.semester.name, day: a.dayOfWeek, time: `${a.startTime}–${a.endTime}` };
  }
  return null;
}

/** Master data (was hardcoded in prisma/seed.ts) — Admin manages it here instead, no code deploy needed. */
export async function createSemester(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const input = parseSemesterInput(formData);
  const error = validateSemesterInput(input, dict);
  if (error) return { ok: false, message: error };

  await prisma.semester.create({ data: input });
  revalidatePath("/admin/master-data");
  revalidatePath("/lesson-plans");
  return { ok: true, message: dict.actions.semesters.created(input.name) };
}

export async function updateSemester(
  id: string,
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const input = parseSemesterInput(formData);
  const error = validateSemesterInput(input, dict);
  if (error) return { ok: false, message: error };

  // New dates may overlap another semester: then the two timetables run at
  // the same time, so refuse if that double-books a teacher or a room (the
  // same rule createSchedule applies when a class is added).
  const clash = await semesterClash(id, input.startDate, input.endDate);
  if (clash) return { ok: false, message: dict.actions.semesters.clash(clash.who, clash.other, clash.day, clash.time) };

  await prisma.semester.update({ where: { id }, data: input });
  revalidatePath("/admin/master-data");
  revalidatePath("/lesson-plans");
  return { ok: true, message: dict.actions.semesters.updated(input.name) };
}

/** Blocked if used in any schedule — a schedule row requires a semester. */
export async function deleteSemester(id: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const semester = await prisma.semester.findUnique({ where: { id }, include: { _count: { select: { schedules: true } } } });
  if (!semester) return { ok: false, message: dict.actions.semesters.notFound };
  if (semester._count!.schedules > 0) {
    return { ok: false, message: dict.actions.semesters.inUse };
  }

  await prisma.semester.delete({ where: { id } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: dict.actions.semesters.deleted(semester.name) };
}
