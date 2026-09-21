import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { saveLessonPlan } from "@/lib/lessonPlans";
import { readUploadBody } from "@/lib/uploadServer";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lesson-plan upload endpoint. Current clients send the file as a raw body
 * (courseId in the query string, name/type in headers); older cached
 * builds still post multipart — both handled by readUploadBody. Always
 * answers JSON so the form can show a message instead of crashing the page.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  const t = dict.actions.lessonPlans;
  if (!session?.user) return NextResponse.json({ ok: false, message: dict.actions.pleaseSignIn }, { status: 401 });

  const body = await readUploadBody(req, { maxBytes: 9 * 1024 * 1024, fileField: "file", log: "lesson-plans/upload" });
  if (!body.ok) {
    const message = body.error === "tooLarge" ? t.fileTooLarge : body.error === "empty" ? dict.actions.upload.emptyBody : dict.actions.upload.parseFailed;
    return NextResponse.json({ ok: false, message }, { status: body.error === "tooLarge" ? 413 : 400 });
  }

  const courseId = req.nextUrl.searchParams.get("courseId") || body.fields.courseId || null;
  const res = await saveLessonPlan(session.user.id, courseId, body.file);
  if (res.ok) revalidatePath("/lesson-plans");
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
