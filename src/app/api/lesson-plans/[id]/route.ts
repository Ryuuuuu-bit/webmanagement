import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Serves a submitted lesson plan file — the owning teacher or any Admin can download it. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const plan = await prisma.lessonPlan.findUnique({ where: { id: params.id } });
  if (!plan) return new NextResponse("Not found", { status: 404 });

  const isOwner = plan.teacherId === session.user.id;
  const isAdmin = session.user.role === "ADMIN";
  if (!isOwner && !isAdmin) return new NextResponse("Forbidden", { status: 403 });

  const body = new Uint8Array(plan.fileData);
  // RFC 5987: `filename*` carries the real (Thai) name; the plain `filename`
  // is an ASCII fallback. A percent-encoded plain `filename` is shown as-is
  // ("%E0%B9%81...pdf") by Safari/Firefox.
  const asciiName = plan.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new NextResponse(body, {
    headers: {
      "Content-Type": plan.mimeType,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(plan.fileName)}`,
      "Content-Length": String(body.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
