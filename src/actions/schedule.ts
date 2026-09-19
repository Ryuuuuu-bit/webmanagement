"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

/**
 * FR-3.2 / FR-15: create a schedule slot, rejecting a teacher/room double-booking.
 * Times are free-form ("HH:MM", like a real calendar) rather than fixed period
 * slots, so the conflict check compares actual time ranges for overlap instead
 * of an exact period match.
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
  const startTime = formData.get("startTime") as string;
  const endTime = formData.get("endTime") as string;

  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    return { ok: false, message: "กรอกเวลาเริ่ม-สิ้นสุดให้ถูกต้อง (HH:MM)" };
  }
  if (endTime <= startTime) {
    return { ok: false, message: "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม" };
  }

  // Two ranges [s1,e1) and [s2,e2) overlap iff s1 < e2 && s2 < e1 — "HH:MM"
  // strings compare correctly as plain strings since they're zero-padded.
  const sameDay = await prisma.schedule.findMany({
    where: { semesterId, dayOfWeek, OR: [{ teacherId }, { roomId }] },
    include: { teacher: true, room: true },
  });
  const conflict = sameDay.find((s) => startTime < s.endTime && s.startTime < endTime);
  if (conflict) {
    const who = conflict.teacherId === teacherId ? `อาจารย์ ${conflict.teacher!.name}` : `ห้อง ${conflict.room!.name}`;
    return { ok: false, message: `ไม่สามารถบันทึกได้ — ${who} ถูกจองไว้แล้วในวัน-เวลานี้ (${conflict.startTime}–${conflict.endTime}) (FR-15)` };
  }

  await prisma.schedule.create({
    data: { teacherId, courseId, roomId, semesterId, dayOfWeek, startTime, endTime },
  });

  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  return { ok: true, message: "บันทึกตารางสอนแล้ว" };
}

/** Admin can delete any schedule slot; a member can only delete their own. */
export async function deleteSchedule(id: string): Promise<{ ok: boolean; message: string }> {
  const session = await requireSession();
  const isAdmin = session.user.role === "ADMIN";

  if (!isAdmin) {
    const schedule = await prisma.schedule.findUnique({ where: { id } });
    if (!schedule || schedule.teacherId !== session.user.id) {
      return { ok: false, message: "ไม่มีสิทธิ์ลบตารางสอนนี้" };
    }
  }

  await prisma.schedule.delete({ where: { id } });
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  return { ok: true, message: "ลบตารางสอนแล้ว" };
}
