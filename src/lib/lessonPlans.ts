import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { notifyAdmins } from "@/lib/notify";

export const LESSON_PLAN_MAX_SIZE = 8 * 1024 * 1024; // 8MB
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
// Some phones report a generic type for Office files — fall back to the extension.
const ALLOWED_EXT = /\.(pdf|docx?|pptx?)$/i;

/**
 * Validates and stores a teacher's lesson plan for one course (one record
 * per teacher+course; resubmitting replaces the file and re-queues it for
 * Admin review). Shared by the /api/lesson-plans/upload route and the
 * legacy server action.
 */
export async function saveLessonPlan(userId: string, courseId: string | null, file: File | null): Promise<{ ok: boolean; message: string }> {
  const dict = getDictionary(getLocale());
  if (!courseId) return { ok: false, message: dict.actions.lessonPlans.courseNotFound };
  if (!file || file.size === 0) return { ok: false, message: dict.actions.lessonPlans.pleaseSelectFile };
  if (file.size > LESSON_PLAN_MAX_SIZE) return { ok: false, message: dict.actions.lessonPlans.fileTooLarge };
  if (!ALLOWED_TYPES.has(file.type) && !ALLOWED_EXT.test(file.name)) {
    return { ok: false, message: dict.actions.lessonPlans.unsupportedType };
  }

  const teaches = await prisma.schedule.findFirst({ where: { teacherId: userId, courseId }, include: { course: true, teacher: { select: { name: true } } } });
  if (!teaches) return { ok: false, message: dict.actions.lessonPlans.notYourCourse };
  const previous = await prisma.lessonPlan.findUnique({ where: { teacherId_courseId: { teacherId: userId, courseId } }, select: { status: true } });

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  await prisma.lessonPlan.upsert({
    where: { teacherId_courseId: { teacherId: userId, courseId } },
    create: { teacherId: userId, courseId, fileName: file.name, fileData: buffer, mimeType, fileSize: file.size, status: "PENDING" },
    update: {
      fileName: file.name,
      fileData: buffer,
      mimeType,
      fileSize: file.size,
      status: "PENDING",
      reviewerId: null,
      reviewNote: null,
      decidedAt: null,
      submittedAt: new Date(),
    },
  });

  await notifyAdmins(
    "LESSON_PLAN_SUBMITTED",
    {
      teacherName: teaches.teacher?.name ?? "-",
      courseCode: teaches.course?.code ?? "-",
      courseName: teaches.course?.name ?? "-",
      resubmit: previous?.status === "NEEDS_REVISION",
    },
    "/lesson-plans",
    { excludeUserId: userId }
  );
  return { ok: true, message: dict.actions.lessonPlans.submitted };
}
