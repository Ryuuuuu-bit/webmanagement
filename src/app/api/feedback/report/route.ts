import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { createIssueReport } from "@/lib/feedback";
import { readUploadBody } from "@/lib/uploadServer";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issue-report endpoint: framed raw body (fields + optional screenshot), see src/lib/uploadClient.ts. Always answers JSON. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return NextResponse.json({ ok: false, message: dict.actions.pleaseSignIn }, { status: 401 });

  const body = await readUploadBody(req, { maxBytes: 6 * 1024 * 1024, fileField: "file", log: "feedback/report" });
  if (!body.ok) {
    const message =
      body.error === "tooLarge" ? dict.actions.feedback.fileTooLarge : body.error === "empty" ? dict.actions.upload.emptyBody : dict.actions.upload.parseFailed;
    return NextResponse.json({ ok: false, message }, { status: body.error === "tooLarge" ? 413 : 400 });
  }
  const f = body.fields;
  const res = await createIssueReport(session.user.id, {
    category: f.category ?? "",
    area: f.area ?? "",
    title: f.title ?? "",
    detail: f.detail ?? "",
    pageUrl: f.pageUrl ?? "",
    file: body.file,
  });
  if (res.ok) revalidatePath("/feedback");
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
