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
  return { name, startDate, endDate };
}

function validateSemesterInput(
  { name, startDate, endDate }: ReturnType<typeof parseSemesterInput>,
  dict: Dictionary
) {
  if (!name) return dict.actions.semesters.fillRequired;
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return dict.actions.semesters.invalidDates;
  if (endDate <= startDate) return dict.actions.semesters.endBeforeStart;
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

  await prisma.semester.update({ where: { id }, data: input });
  revalidatePath("/admin/master-data");
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
