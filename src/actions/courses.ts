"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

function parseCourseInput(formData: FormData) {
  return {
    code: (formData.get("code") as string || "").trim().toUpperCase(),
    name: (formData.get("name") as string || "").trim(),
  };
}

/** Master data (was hardcoded in prisma/seed.ts) — Admin manages it here instead, no code deploy needed. */
export async function createCourse(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const { code, name } = parseCourseInput(formData);
  if (!code || !name) return { ok: false, message: dict.actions.courses.fillRequired };

  const existing = await prisma.course.findUnique({ where: { code } });
  if (existing) return { ok: false, message: dict.actions.courses.codeExists };

  await prisma.course.create({ data: { code, name } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: dict.actions.courses.created(`${code} ${name}`) };
}

export async function updateCourse(
  id: string,
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const { code, name } = parseCourseInput(formData);
  if (!code || !name) return { ok: false, message: dict.actions.courses.fillRequired };

  const conflict = await prisma.course.findFirst({ where: { code, NOT: { id } } });
  if (conflict) return { ok: false, message: dict.actions.courses.codeExists };

  await prisma.course.update({ where: { id }, data: { code, name } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: dict.actions.courses.updated(`${code} ${name}`) };
}

/** Blocked if used in any schedule or lesson-plan submission — those rows require a course. */
export async function deleteCourse(id: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const course = await prisma.course.findUnique({
    where: { id },
    include: { _count: { select: { schedules: true, lessonPlans: true } } },
  });
  if (!course) return { ok: false, message: dict.actions.courses.notFound };
  if (course._count!.schedules > 0 || course._count!.lessonPlans > 0) {
    return { ok: false, message: dict.actions.courses.inUse };
  }

  await prisma.course.delete({ where: { id } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: dict.actions.courses.deleted(`${course.code} ${course.name}`) };
}
