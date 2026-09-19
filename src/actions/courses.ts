"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const { code, name } = parseCourseInput(formData);
  if (!code || !name) return { ok: false, message: "กรอกรหัสวิชาและชื่อวิชาให้ครบ" };

  const existing = await prisma.course.findUnique({ where: { code } });
  if (existing) return { ok: false, message: "มีรหัสวิชานี้อยู่แล้ว" };

  await prisma.course.create({ data: { code, name } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: `เพิ่มวิชา "${code} ${name}" แล้ว` };
}

export async function updateCourse(
  id: string,
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const { code, name } = parseCourseInput(formData);
  if (!code || !name) return { ok: false, message: "กรอกรหัสวิชาและชื่อวิชาให้ครบ" };

  const conflict = await prisma.course.findFirst({ where: { code, NOT: { id } } });
  if (conflict) return { ok: false, message: "มีรหัสวิชานี้อยู่แล้ว" };

  await prisma.course.update({ where: { id }, data: { code, name } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: `บันทึกวิชา "${code} ${name}" แล้ว` };
}

/** Blocked if used in any schedule or lesson-plan submission — those rows require a course. */
export async function deleteCourse(id: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const course = await prisma.course.findUnique({
    where: { id },
    include: { _count: { select: { schedules: true, lessonPlans: true } } },
  });
  if (!course) return { ok: false, message: "ไม่พบวิชานี้" };
  if (course._count!.schedules > 0 || course._count!.lessonPlans > 0) {
    return { ok: false, message: "ลบไม่ได้ — วิชานี้ถูกใช้อยู่ในตารางสอนหรือแผนการสอนแล้ว ลบตารางสอน/แผนการสอนที่เกี่ยวข้องก่อน" };
  }

  await prisma.course.delete({ where: { id } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: `ลบวิชา "${course.code} ${course.name}" แล้ว` };
}
