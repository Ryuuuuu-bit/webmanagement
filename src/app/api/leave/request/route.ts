import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { createLeaveRequest } from "@/lib/leave";
import { readUploadBody } from "@/lib/uploadServer";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Leave-request endpoint (see src/lib/leave.ts). Current clients send the
 * form fields as a length-prefixed JSON frame and the optional attachment as
 * the raw body; older cached builds post multipart. Always answers JSON.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return NextResponse.json({ ok: false, message: dict.actions.pleaseSignIn }, { status: 401 });

  // 5 MB attachment + form slack.
  const body = await readUploadBody(req, { maxBytes: 6 * 1024 * 1024, fileField: "file", log: "leave/request" });
  if (!body.ok) {
    const message =
      body.error === "tooLarge" ? dict.actions.leave.fileTooLarge : body.error === "empty" ? dict.actions.upload.emptyBody : dict.actions.upload.parseFailed;
    return NextResponse.json({ ok: false, message }, { status: body.error === "tooLarge" ? 413 : 400 });
  }
  const f = body.fields;
  const res = await createLeaveRequest(session.user.id, {
    type: f.type ?? "",
    from: f.from ?? "",
    to: f.to ?? "",
    halfDay: f.halfDay ?? "",
    reason: f.reason ?? "",
    file: body.file,
  });
  if (res.ok) {
    revalidatePath("/leave");
    revalidatePath("/dashboard");
  }
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
