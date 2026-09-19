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

  return new NextResponse(new Uint8Array(plan.fileData), {
    headers: {
      "Content-Type": plan.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(plan.fileName)}"`,
      "Content-Length": String(plan.fileSize),
    },
  });
}
