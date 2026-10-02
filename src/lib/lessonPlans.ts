import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { notifyAdmins } from "@/lib/notify";
import { getActiveSemester } from "@/lib/semesters";

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
 * Validates and stores a teacher's lesson plan for one course in one
 * semester (one record per teacher + course + semester; resubmitting
 * replaces the file and re-queues it for Admin review). Shared by the
 * /api/lesson-plans/upload route and the legacy server action. Without a
 * semesterId (older cached clients) the active semester is used.
 */
export async function saveLessonPlan(userId: string, courseId: string | null, file: File | null, semesterIdIn?: string | null): Promise<{ ok: boolean; message: string }> {
  const dict = getDictionary(getLocale());
  if (!courseId) return { ok: false, message: dict.actions.lessonPlans.courseNotFound };
  if (!file || file.size === 0) return { ok: false, message: dict.actions.lessonPlans.pleaseSelectFile };
  if (file.size > LESSON_PLAN_MAX_SIZE) return { ok: false, message: dict.actions.lessonPlans.fileTooLarge };
  if (!ALLOWED_TYPES.has(file.type) && !ALLOWED_EXT.test(file.name)) {
    return { ok: false, message: dict.actions.lessonPlans.unsupportedType };
  }

  const semesterId = semesterIdIn || (await getActiveSemester())?.id || null;
  if (!semesterId) return { ok: false, message: dict.actions.lessonPlans.noSemester };
  const teaches = await prisma.schedule.findFirst({ where: { teacherId: userId, courseId, semesterId }, include: { course: true, teacher: { select: { name: true } }, semester: { select: { name: true } } } });
  if (!teaches) return { ok: false, message: dict.actions.lessonPlans.notYourCourse };
  const previous = await prisma.lessonPlan.findFirst({ where: { teacherId: userId, courseId, semesterId }, select: { id: true, status: true } });

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const fresh = { teacherId: userId, courseId, semesterId, fileName: file.name, fileData: buffer, mimeType, fileSize: file.size, status: "PENDING" as const };
  const replace = (id: string) => prisma.lessonPlan.update({
    where: { id },
    data: {
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
  if (previous) await replace(previous.id);
  else {
    try {
      await prisma.lessonPlan.create({ data: fresh });
    } catch {
      // Two uploads racing for the same slot: the unique key let one create
      // through — this one replaces it instead.
      const winner = await prisma.lessonPlan.findFirst({ where: { teacherId: userId, courseId, semesterId }, select: { id: true } });
      if (!winner) throw new Error("lesson plan save failed");
      await replace(winner.id);
    }
  }

  await notifyAdmins(
    "LESSON_PLAN_SUBMITTED",
    {
      teacherName: teaches.teacher?.name ?? "-",
      courseCode: teaches.course?.code ?? "-",
      courseName: teaches.course?.name ?? "-",
      semester: teaches.semester?.name ?? null,
      resubmit: previous?.status === "NEEDS_REVISION",
    },
    "/lesson-plans",
    { excludeUserId: userId }
  );
  return { ok: true, message: dict.actions.lessonPlans.submitted };
}


export type PlanSlot = {
  teacherId: string;
  teacherName: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  plan: { id: string; status: "PENDING" | "APPROVED" | "NEEDS_REVISION"; submittedAt: Date } | null;
};

/**
 * Every (teacher, course) pair that needs a lesson plan in this semester —
 * derived from the timetable — with the plan submitted for it, if any.
 * "Missing" = no plan yet, or one sent back for revision.
 */
export async function lessonPlanSlots(semesterId: string): Promise<PlanSlot[]> {
  const [pairs, plans] = await Promise.all([
    prisma.schedule.findMany({
      where: { semesterId, teacher: { isActive: true } },
      distinct: ["teacherId", "courseId"],
      select: { teacherId: true, courseId: true, teacher: { select: { name: true } }, course: { select: { code: true, name: true } } },
    }),
    prisma.lessonPlan.findMany({ where: { semesterId }, select: { id: true, teacherId: true, courseId: true, status: true, submittedAt: true } }),
  ]);
  const byKey = new Map(plans.map((p) => [`${p.teacherId}:${p.courseId}`, p]));
  return pairs
    .map((x) => {
      const p = byKey.get(`${x.teacherId}:${x.courseId}`);
      return {
        teacherId: x.teacherId,
        teacherName: x.teacher.name,
        courseId: x.courseId,
        courseCode: x.course.code,
        courseName: x.course.name,
        plan: p ? { id: p.id, status: p.status, submittedAt: p.submittedAt } : null,
      };
    })
    .sort((a, b) => a.teacherName.localeCompare(b.teacherName, "th") || a.courseCode.localeCompare(b.courseCode));
}

export const isMissing = (s: PlanSlot) => !s.plan || s.plan.status === "NEEDS_REVISION";
