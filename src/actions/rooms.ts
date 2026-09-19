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
  const dict = getDictionary(getLocale());

  const { name, building } = parseRoomInput(formData);
  if (!name || !building) return { ok: false, message: dict.actions.rooms.fillRequired };

  await prisma.room.create({ data: { name, building } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: dict.actions.rooms.created(name, building) };
}

export async function updateRoom(
  id: string,
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const { name, building } = parseRoomInput(formData);
  if (!name || !building) return { ok: false, message: dict.actions.rooms.fillRequired };

  await prisma.room.update({ where: { id }, data: { name, building } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: dict.actions.rooms.updated(name) };
}

/** Blocked if used in any schedule — a schedule row requires a room. */
export async function deleteRoom(id: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const room = await prisma.room.findUnique({ where: { id }, include: { _count: { select: { schedules: true } } } });
  if (!room) return { ok: false, message: dict.actions.rooms.notFound };
  if (room._count!.schedules > 0) {
    return { ok: false, message: dict.actions.rooms.inUse };
  }

  await prisma.room.delete({ where: { id } });
  revalidatePath("/admin/master-data");
  return { ok: true, message: dict.actions.rooms.deleted(room.name) };
}
