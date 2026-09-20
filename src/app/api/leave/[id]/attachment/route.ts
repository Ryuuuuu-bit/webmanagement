import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves a leave request's supporting document to Admin or the requester only. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  const row = await prisma.leaveRequest.findUnique({
    where: { id: params.id },
    select: { requesterId: true, attachmentName: true, attachmentMime: true, attachmentData: true },
  });
  if (!row || !row.attachmentData) return new NextResponse("Not found", { status: 404 });
  if (session.user.role !== "ADMIN" && row.requesterId !== session.user.id) return new NextResponse("Forbidden", { status: 403 });
  const name = encodeURIComponent(row.attachmentName ?? "attachment");
  const mime = row.attachmentMime ?? "application/octet-stream";
  // Only PDFs/images are ever stored (src/lib/leave.ts); still: nosniff and a
  // sandboxing CSP so nothing served here can run script on our origin.
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
