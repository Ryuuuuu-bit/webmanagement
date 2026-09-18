"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PERIODS = [
  { start: "08:30", end: "10:20" },
  { start: "10:30", end: "12:20" },
  { start: "13:00", end: "14:50" },
  { start: "15:00", end: "16:50" },
];

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

/** FR-3.2 / FR-15: create a schedule slot, rejecting a teacher/room double-booking. */
export async function createSchedule(formData: FormData) {
  await requireAdmin();

  const teacherId = formData.get("teacherId") as string;
  const courseId = formData.get("courseId") as string;
  const roomId = formData.get("roomId") as string;
  const semesterId = formData.get("semesterId") as string;
  const dayOfWeek = Number(formData.get("dayOfWeek"));
  const periodIndex = Number(formData.get("periodIndex"));
  const period = PERIODS[periodIndex];

  const conflict = await prisma.schedule.findFirst({
    where: {
      semesterId,
      dayOfWeek,
      periodIndex,
      OR: [{ teacherId }, { roomId }],
    },
    include: { teacher: true, room: true },
  });
  if (conflict) {
    const who = conflict.teacherId === teacherId ? `อาจารย์ ${conflict.teacher!.name}` : `ห้อง ${conflict.room!.name}`;
    return { ok: false, message: `ไม่สามารถบันทึกได้ — ${who} ถูกจองไว้แล้วในวัน-เวลานี้ (FR-15)` };
  }

  await prisma.schedule.create({
    data: { teacherId, courseId, roomId, semesterId, dayOfWeek, periodIndex, startTime: period.start, endTime: period.end },
  });

  revalidatePath("/schedule");
  return { ok: true, message: "บันทึกตารางสอนแล้ว" };
}

export async function deleteSchedule(id: string) {
  await requireAdmin();
  await prisma.schedule.delete({ where: { id } });
  revalidatePath("/schedule");
}
