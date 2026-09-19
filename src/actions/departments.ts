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

/** Master data (was hardcoded in prisma/seed.ts) — Admin manages it here instead, no code deploy needed. */
export async function createDepartment(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const name = (formData.get("name") as string || "").trim();
  if (!name) return { ok: false, message: "กรอกชื่อสาขาวิชา" };

  const existing = await prisma.department.findUnique({ where: { name } });
  if (existing) return { ok: false, message: "มีสาขาวิชานี้อยู่แล้ว" };

  await prisma.department.create({ data: { name } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: `เพิ่มสาขาวิชา "${name}" แล้ว` };
}

export async function updateDepartment(
  id: string,
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const name = (formData.get("name") as string || "").trim();
  if (!name) return { ok: false, message: "กรอกชื่อสาขาวิชา" };

  const conflict = await prisma.department.findFirst({ where: { name, NOT: { id } } });
  if (conflict) return { ok: false, message: "มีสาขาวิชาชื่อนี้อยู่แล้ว" };

  await prisma.department.update({ where: { id }, data: { name } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: `บันทึกสาขาวิชา "${name}" แล้ว` };
}

/** Blocked if any user is still assigned — avoids silently orphaning their department. */
export async function deleteDepartment(id: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const dept = await prisma.department.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!dept) return { ok: false, message: "ไม่พบสาขาวิชานี้" };
  if (dept._count!.users > 0) {
    return { ok: false, message: `ลบไม่ได้ — ยังมีผู้ใช้ ${dept._count!.users} คนอยู่ในสาขาวิชานี้ ย้ายออกก่อนแล้วค่อยลบ` };
  }

  await prisma.department.delete({ where: { id } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: `ลบสาขาวิชา "${dept.name}" แล้ว` };
}
