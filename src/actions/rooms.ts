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

function parseRoomInput(formData: FormData) {
  return {
    name: (formData.get("name") as string || "").trim(),
    building: (formData.get("building") as string || "").trim(),
  };
}

/** Master data (was hardcoded in prisma/seed.ts) — Admin manages it here instead, no code deploy needed. */
export async function createRoom(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const { name, building } = parseRoomInput(formData);
  if (!name || !building) return { ok: false, message: "กรอกชื่อห้องและอาคารให้ครบ" };

  await prisma.room.create({ data: { name, building } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: `เพิ่มห้อง "${name}" (${building}) แล้ว` };
}

export async function updateRoom(
  id: string,
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const { name, building } = parseRoomInput(formData);
  if (!name || !building) return { ok: false, message: "กรอกชื่อห้องและอาคารให้ครบ" };

  await prisma.room.update({ where: { id }, data: { name, building } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: `บันทึกห้อง "${name}" แล้ว` };
}

/** Blocked if used in any schedule — a schedule row requires a room. */
export async function deleteRoom(id: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();

  const room = await prisma.room.findUnique({ where: { id }, include: { _count: { select: { schedules: true } } } });
  if (!room) return { ok: false, message: "ไม่พบห้องนี้" };
  if (room._count!.schedules > 0) {
    return { ok: false, message: "ลบไม่ได้ — ห้องนี้ถูกใช้อยู่ในตารางสอนแล้ว ลบตารางสอนที่เกี่ยวข้องก่อน" };
  }

  await prisma.room.delete({ where: { id } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: `ลบห้อง "${room.name}" แล้ว` };
}
