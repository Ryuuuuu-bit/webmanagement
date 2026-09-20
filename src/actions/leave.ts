"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LeaveType, RequestStatus } from "@prisma/client";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { countLeaveDays, getLeaveQuotaMap, getLeaveUsedDays } from "@/lib/leaveQuota";

export async function requestLeave(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("Unauthorized");
  const dict = getDictionary(getLocale());

  const type = formData.get("type") as LeaveType;
  const startDate = new Date(formData.get("from") as string);
  const endDate = new Date(formData.get("to") as string);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return { ok: false, message: dict.actions.leave.invalidDates };
  }
  if (endDate < startDate) {
    return { ok: false, message: dict.actions.leave.endBeforeStart };
  }

  // Not blocking (client decision: warn, don't block) — checked BEFORE
  // creating the row so "used" below doesn't double-count this request.
  const days = countLeaveDays(startDate, endDate);
  const year = startDate.getUTCFullYear();
  const [quotaMap, usedBefore] = await Promise.all([
    getLeaveQuotaMap(),
    getLeaveUsedDays(session.user.id, type, year),
  ]);
  const quota = quotaMap[type];

  await prisma.leaveRequest.create({
    data: {
      requesterId: session.user.id,
      type,
      startDate,
      endDate,
      reason: (formData.get("reason") as string) || "-",
    },
  });

  revalidatePath("/leave");
  revalidatePath("/dashboard");

  const usedAfter = usedBefore + days;
  if (quota > 0 && usedAfter > quota) {
    return { ok: true, message: dict.actions.leave.submittedOverQuota(usedAfter, quota) };
  }
  return { ok: true, message: dict.actions.leave.submitted };
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
