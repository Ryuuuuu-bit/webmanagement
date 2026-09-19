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

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

/**
 * FR-3.2 / FR-15: create a schedule slot, rejecting a teacher/room double-booking.
 * Admin can create a slot for any teacher; a member (teacher) can only add to
 * their own schedule — the submitted teacherId is ignored and forced to their
 * own id so a member can never book time for someone else.
 */
export async function createSchedule(formData: FormData) {
  const session = await requireSession();
  const isAdmin = session.user.role === "ADMIN";

  const teacherId = isAdmin ? (formData.get("teacherId") as string) : session.user.id;
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

/** Admin can delete any schedule slot; a member can only delete their own. */
export async function deleteSchedule(id: string) {
  const session = await requireSession();
  const isAdmin = session.user.role === "ADMIN";

  if (!isAdmin) {
    const schedule = await prisma.schedule.findUnique({ where: { id } });
    if (!schedule || schedule.teacherId !== session.user.id) throw new Error("Unauthorized");
  }

  await prisma.schedule.delete({ where: { id } });
  revalidatePath("/schedule");
}
