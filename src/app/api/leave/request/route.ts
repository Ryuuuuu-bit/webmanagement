import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { createLeaveRequest } from "@/lib/leave";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Multipart leave-request endpoint (see src/lib/leave.ts). Always answers JSON. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return NextResponse.json({ ok: false, message: dict.actions.pleaseSignIn }, { status: 401 });
  // Refuse oversized bodies before buffering them (5 MB file + form slack).
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 6 * 1024 * 1024) return NextResponse.json({ ok: false, message: dict.actions.leave.fileTooLarge }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, message: dict.actions.leave.uploadInterrupted }, { status: 400 });
  }
  const file = form.get("file");
  const res = await createLeaveRequest(session.user.id, {
    type: String(form.get("type") ?? ""),
    from: String(form.get("from") ?? ""),
    to: String(form.get("to") ?? ""),
    halfDay: String(form.get("halfDay") ?? ""),
    reason: String(form.get("reason") ?? ""),
    file: file instanceof File ? file : null,
  });
  if (res.ok) {
    revalidatePath("/leave");
    revalidatePath("/dashboard");
  }
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
