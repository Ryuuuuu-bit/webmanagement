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
  return new NextResponse(Buffer.from(row.attachmentData), {
    headers: {
      "Content-Type": row.attachmentMime ?? "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
    },
  });
}
