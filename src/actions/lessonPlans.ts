"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { saveLessonPlan } from "@/lib/lessonPlans";

/**
 * FR-6: teacher submits/resubmits their lesson plan for a course they teach.
 * The browser now posts to /api/lesson-plans/upload (a Route Handler) rather
 * than this action — multipart uploads through Server Actions were failing
 * on phones with "Unexpected end of form". Kept as a thin wrapper around the
 * shared saveLessonPlan for any caller that still has the action.
 */
export async function submitLessonPlan(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return { ok: false, message: dict.actions.pleaseSignIn };
  const res = await saveLessonPlan(session.user.id, formData.get("courseId") as string, formData.get("file") as File | null);
  if (res.ok) revalidatePath("/lesson-plans");
  return res;
}

/** Admin approves a lesson plan, or sends it back with a note asking for changes. */
export async function reviewLessonPlan(
  id: string,
  decision: "APPROVED" | "NEEDS_REVISION",
  note: string
): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  const dict = getDictionary(getLocale());

  const trimmedNote = note.trim();
  if (decision === "NEEDS_REVISION" && !trimmedNote) {
    return { ok: false, message: dict.actions.lessonPlans.needsNote };
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
  return { ok: true, message: decision === "APPROVED" ? dict.actions.lessonPlans.approved : dict.actions.lessonPlans.sentBack };
}
