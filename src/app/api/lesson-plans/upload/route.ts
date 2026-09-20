import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { saveLessonPlan } from "@/lib/lessonPlans";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lesson-plan upload endpoint. A plain multipart POST handled here is far
 * more robust than a Server Action carrying a File (mobile Safari/Chrome
 * were hitting "Unexpected end of form" mid-stream, which surfaced as a
 * full-page application error). Always answers JSON so the form can show
 * a message instead of crashing the page.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return NextResponse.json({ ok: false, message: dict.actions.pleaseSignIn }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    console.error("[lesson-plans/upload] bad multipart:", err);
    return NextResponse.json({ ok: false, message: dict.actions.lessonPlans.uploadInterrupted }, { status: 400 });
  }

  const courseId = (form.get("courseId") as string | null) ?? null;
  const file = form.get("file");
  const res = await saveLessonPlan(session.user.id, courseId, file instanceof File ? file : null);
  if (res.ok) revalidatePath("/lesson-plans");
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
