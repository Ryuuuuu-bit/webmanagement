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

function parseSemesterInput(formData: FormData) {
  const name = (formData.get("name") as string || "").trim();
  const startDate = new Date(formData.get("startDate") as string);
  const endDate = new Date(formData.get("endDate") as string);
  return { name, startDate, endDate };
}

function validateSemesterInput({ name, startDate, endDate }: ReturnType<typeof parseSemesterInput>) {
  if (!name) return "กรอกชื่อภาคเรียน";
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return "กรอกวันที่เริ่ม-สิ้นสุดให้ถูกต้อง";
  if (endDate <= startDate) return "วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น";
  return null;
}

/** Master data (was hardcoded in prisma/seed.ts) — Admin manages it here instead, no code deploy needed. */
export async function createSemester(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const input = parseSemesterInput(formData);
  const error = validateSemesterInput(input);
  if (error) return { ok: false, message: error };

  await prisma.semester.create({ data: input });
  revalidatePath("/admin/master-data");
  return { ok: true, message: `เพิ่มภาคเรียน "${input.name}" แล้ว` };
}

export async function updateSemester(
  id: string,
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const input = parseSemesterInput(formData);
  const error = validateSemesterInput(input);
  if (error) return { ok: false, message: error };

  await prisma.semester.update({ where: { id }, data: input });
  revalidatePath("/admin/master-data");
  return { ok: true, message: `บันทึกภาคเรียน "${input.name}" แล้ว` };
}

/** Blocked if used in any schedule — a schedule row requires a semester. */
export async function deleteSemester(id: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const semester = await prisma.semester.findUnique({ where: { id }, include: { _count: { select: { schedules: true } } } });
  if (!semester) return { ok: false, message: "ไม่พบภาคเรียนนี้" };
  if (semester._count!.schedules > 0) {
    return { ok: false, message: "ลบไม่ได้ — ภาคเรียนนี้ถูกใช้อยู่ในตารางสอนแล้ว ลบตารางสอนที่เกี่ยวข้องก่อน" };
  }

  await prisma.semester.delete({ where: { id } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: `ลบภาคเรียน "${semester.name}" แล้ว` };
}
