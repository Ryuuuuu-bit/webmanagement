import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readUploadBody } from "@/lib/uploadServer";
import { attachmentMime, DOC_ATTACHMENT_MAX } from "@/lib/documents";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves a teacher document's scan to Admin or the teacher it belongs to. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  const row = await prisma.teacherDocument.findUnique({
    where: { id: params.id },
    select: { userId: true, attachmentName: true, attachmentMime: true, attachmentData: true },
  });
  if (!row || !row.attachmentData) return new NextResponse("Not found", { status: 404 });
  if (session.user.role !== "ADMIN" && row.userId !== session.user.id) return new NextResponse("Forbidden", { status: 403 });
  const name = encodeURIComponent(row.attachmentName ?? "document");
  const mime = row.attachmentMime ?? "application/octet-stream";
  const safeInline = mime === "application/pdf" || mime.startsWith("image/");
  return new NextResponse(Buffer.from(row.attachmentData), {
    headers: {
      "Content-Type": safeInline ? mime : "application/octet-stream",
      "Content-Disposition": `${safeInline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store",
    },
  });
}

/** Admin attaches/replaces the scan (raw body, see src/lib/uploadClient.ts). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ ok: false, message: dict.actions.unauthorized }, { status: 403 });

  const body = await readUploadBody(req, { maxBytes: DOC_ATTACHMENT_MAX + 64 * 1024, fileField: "file", log: "documents/file" });
  if (!body.ok) {
    const message =
      body.error === "tooLarge" ? dict.actions.documents.fileTooLarge : body.error === "empty" ? dict.actions.upload.emptyBody : dict.actions.upload.parseFailed;
    return NextResponse.json({ ok: false, message }, { status: body.error === "tooLarge" ? 413 : 400 });
  }
  const file = body.file;
  if (!file) return NextResponse.json({ ok: false, message: dict.actions.upload.emptyBody }, { status: 400 });
  if (file.size > DOC_ATTACHMENT_MAX) return NextResponse.json({ ok: false, message: dict.actions.documents.fileTooLarge }, { status: 413 });
  const mime = attachmentMime(file.name, file.type);
  if (!mime) return NextResponse.json({ ok: false, message: dict.actions.documents.fileType }, { status: 400 });

  const res = await prisma.teacherDocument.updateMany({
    where: { id: params.id },
    data: { attachmentName: file.name.slice(0, 200), attachmentMime: mime, attachmentSize: file.size, attachmentData: Buffer.from(await file.arrayBuffer()) },
  });
  if (res.count === 0) return NextResponse.json({ ok: false, message: dict.actions.documents.notFound }, { status: 404 });
  revalidatePath("/documents");
  return NextResponse.json({ ok: true, message: dict.actions.documents.fileSaved });
}
