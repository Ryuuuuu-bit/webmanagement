"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LeaveType, RequestStatus } from "@prisma/client";

export async function requestLeave(formData: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("Unauthorized");

  await prisma.leaveRequest.create({
    data: {
      requesterId: session.user.id,
      type: formData.get("type") as LeaveType,
      startDate: new Date(formData.get("from") as string),
      endDate: new Date(formData.get("to") as string),
      reason: (formData.get("reason") as string) || "-",
    },
  });

  revalidatePath("/leave");
  revalidatePath("/dashboard");
}

/** FR-8: Admin approves or rejects a leave request. */
export async function decideLeave(id: string, decision: "APPROVED" | "REJECTED") {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }

  await prisma.leaveRequest.update({
    where: { id },
    data: { status: decision as RequestStatus, approverId: session.user.id, decidedAt: new Date() },
  });

  revalidatePath("/leave");
  revalidatePath("/dashboard");
}
