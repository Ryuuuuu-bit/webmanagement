"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_SIZE = 8 * 1024 * 1024; // 8MB
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

/**
 * FR-6: teacher submits/resubmits their lesson plan for a course they teach.
 * One record per (teacher, course) — resubmitting overwrites the file and
 * resets status to PENDING so it re-enters the Admin review queue.
 */
export async function submitLessonPlan(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false, message: "กรุณาเข้าสู่ระบบ" };

  const courseId = formData.get("courseId") as string;
  const file = formData.get("file") as File | null;

  if (!courseId) return { ok: false, message: "ไม่พบวิชา" };
  if (!file || file.size === 0) return { ok: false, message: "กรุณาเลือกไฟล์แผนการสอน" };
  if (file.size > MAX_SIZE) return { ok: false, message: "ไฟล์ใหญ่เกินไป (จำกัดไม่เกิน 8MB)" };
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, message: "รองรับเฉพาะไฟล์ PDF, Word หรือ PowerPoint เท่านั้น" };
  }

  // Only let a teacher submit a plan for a course they actually teach.
  const teaches = await prisma.schedule.findFirst({ where: { teacherId: session.user.id, courseId } });
  if (!teaches) return { ok: false, message: "คุณไม่มีตารางสอนวิชานี้" };

  const buffer = Buffer.from(await file.arrayBuffer());

  await prisma.lessonPlan.upsert({
    where: { teacherId_courseId: { teacherId: session.user.id, courseId } },
    create: {
      teacherId: session.user.id,
      courseId,
      fileName: file.name,
      fileData: buffer,
      mimeType: file.type,
      fileSize: file.size,
      status: "PENDING",
    },
    update: {
      fileName: file.name,
      fileData: buffer,
      mimeType: file.type,
      fileSize: file.size,
      status: "PENDING",
      reviewerId: null,
      reviewNote: null,
      decidedAt: null,
      submittedAt: new Date(),
    },
  });

  revalidatePath("/lesson-plans");
  return { ok: true, message: "ส่งแผนการสอนแล้ว รอ Admin ตรวจสอบ" };
}

/** Admin approves a lesson plan, or sends it back with a note asking for changes. */
export async function reviewLessonPlan(
  id: string,
  decision: "APPROVED" | "NEEDS_REVISION",
  note: string
): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");

  const trimmedNote = note.trim();
  if (decision === "NEEDS_REVISION" && !trimmedNote) {
    return { ok: false, message: "กรุณาระบุสิ่งที่ต้องแก้ไขให้ครูทราบด้วย" };
  }

  await prisma.lessonPlan.update({
    where: { id },
    data: {
      status: decision,
      reviewerId: session.user.id,
      reviewNote: trimmedNote || null,
      decidedAt: new Date(),
    },
  });

  revalidatePath("/lesson-plans");
  return { ok: true, message: decision === "APPROVED" ? "อนุมัติแผนการสอนแล้ว" : "ส่งกลับให้ครูแก้ไขแล้ว" };
}
