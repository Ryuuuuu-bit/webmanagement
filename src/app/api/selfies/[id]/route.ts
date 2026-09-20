import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Serves a check-in/out selfie — the teacher it belongs to or any Admin. Never cached by shared caches. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const selfie = await prisma.selfie.findUnique({ where: { id: params.id } });
  if (!selfie) return new NextResponse("Not found", { status: 404 });
  if (selfie.userId !== session.user.id && session.user.role !== "ADMIN") {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(new Uint8Array(selfie.data), {
    headers: {
      "Content-Type": selfie.mimeType,
      "Content-Length": String(selfie.data.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
