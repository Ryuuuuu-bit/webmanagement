"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RequestStatus } from "@prisma/client";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { notifyAdmins, notifyUser } from "@/lib/notify";
import { createLeaveRequest } from "@/lib/leave";

/**
 * Legacy entry point — the form now posts multipart to /api/leave/request
 * (attachments). Kept as a thin wrapper around the shared createLeaveRequest.
 */
export async function requestLeave(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("Unauthorized");
  const file = formData.get("file");
  const res = await createLeaveRequest(session.user.id, {
    type: String(formData.get("type") ?? ""),
    from: String(formData.get("from") ?? ""),
    to: String(formData.get("to") ?? ""),
    halfDay: String(formData.get("halfDay") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    file: file instanceof File ? file : null,
  });
  if (res.ok) {
    revalidatePath("/leave");
    revalidatePath("/dashboard");
  }
  return res;
}

/** Requester withdraws their own request while it is still pending. */
export async function cancelLeave(id: string): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return { ok: false, message: dict.actions.pleaseSignIn };
  const row = await prisma.leaveRequest.findUnique({ where: { id }, select: { requesterId: true, status: true, type: true, startDate: true, endDate: true } });
  if (!row || row.requesterId !== session.user.id) return { ok: false, message: dict.actions.leave.notFound };
  if (row.status !== "PENDING") return { ok: false, message: dict.actions.leave.cannotCancel };
  const claimed = await prisma.leaveRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  if (claimed.count === 0) return { ok: false, message: dict.actions.leave.cannotCancel };
  const requester = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } });
  await notifyAdmins(
    "LEAVE_CANCELLED",
    { requesterName: requester?.name ?? "-", type: row.type, from: row.startDate.toISOString(), to: row.endDate.toISOString() },
    "/leave",
    { excludeUserId: session.user.id }
  );
  revalidatePath("/leave");
  revalidatePath("/dashboard");
  return { ok: true, message: dict.actions.leave.cancelled };
}

/** FR-8: Admin approves or rejects a leave request. */
export async function decideLeave(id: string, decision: "APPROVED" | "REJECTED") {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }

  // Only a pending request can be decided — a request the teacher already
  // withdrew must not silently come back as approved.
  const claimed = await prisma.leaveRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: decision as RequestStatus, approverId: session.user.id, decidedAt: new Date() },
  });
  if (claimed.count === 0) {
    revalidatePath("/leave");
    return;
  }
  const updated = await prisma.leaveRequest.findUnique({ where: { id }, include: { approver: { select: { name: true } } } });
  if (updated && decision === "APPROVED" && !updated.halfDay) {
    // Mark each approved day as LEAVE on the attendance sheet (unless the
    // person actually checked in that day). Half-day leave keeps the real
    // check-in/out record. Capped at 120 days per request.
    const start = new Date(updated.startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(updated.endDate);
    end.setHours(0, 0, 0, 0);
    for (let d = new Date(start), n = 0; d <= end && n < 120; d.setDate(d.getDate() + 1), n++) {
      const day = new Date(d);
      const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: updated.requesterId, date: day } }, select: { checkinAt: true } });
      if (existing?.checkinAt) continue;
      await prisma.attendance.upsert({
        where: { userId_date: { userId: updated.requesterId, date: day } },
        create: { userId: updated.requesterId, date: day, status: "LEAVE" },
        update: { status: "LEAVE" },
      });
    }
    revalidatePath("/checkin");
    revalidatePath("/teachers");
  }
  if (updated) {
    await notifyUser(
      updated.requesterId,
      "LEAVE_DECIDED",
      { decision, type: updated.type, from: updated.startDate.toISOString(), to: updated.endDate.toISOString(), approverName: updated.approver?.name ?? session.user.name ?? "-" },
      "/leave"
    );
  }

  revalidatePath("/leave");
  revalidatePath("/dashboard");
}
