"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/security";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * Admin deletes a member's transaction history (client request: "admin
 * สามารถลบประวัติการทำรายการต่างๆ ได้"). Four record types, each deletable
 * one row at a time or wholesale per person. Every deletion is written to
 * the security audit log with enough detail to know what was removed —
 * the records themselves are gone for good (no soft delete), which is the
 * point: a wrong check-in, a test leave request, a duplicate attestation.
 *
 * Attendance rows own their selfies (evidence photos) — those go with the
 * row. Lesson-plan files are stored in the row itself.
 */

export type RecordKind = "attendance" | "leave" | "attest" | "lessonPlan";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

function revalidateAll(userId: string) {
  revalidatePath(`/admin/users/${userId}/history`);
  revalidatePath("/checkin");
  revalidatePath("/leave");
  revalidatePath("/attest");
  revalidatePath("/lesson-plans");
  revalidatePath("/dashboard");
  revalidatePath("/teachers");
}

async function deleteAttendanceRows(where: { id?: string; userId?: string }) {
  const rows = await prisma.attendance.findMany({
    where,
    select: { id: true, userId: true, date: true, checkinSelfieId: true, checkoutSelfieId: true },
  });
  if (rows.length === 0) return rows;
  const selfieIds = rows.flatMap((r) => [r.checkinSelfieId, r.checkoutSelfieId]).filter((x): x is string => !!x);
  await prisma.$transaction([
    prisma.attendance.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
    ...(selfieIds.length > 0 ? [prisma.selfie.deleteMany({ where: { id: { in: selfieIds } } })] : []),
  ]);
  return rows;
}

/** Delete one record of the given kind. Returns the owner's id so the page can refresh. */
export async function deleteRecord(kind: RecordKind, id: string): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());
  const ip = getClientIp();
  let userId: string | null = null;
  let detail = "";

  if (kind === "attendance") {
    const rows = await deleteAttendanceRows({ id });
    if (rows.length === 0) return { ok: false, message: dict.history.notFound };
    userId = rows[0].userId;
    detail = `attendance ${rows[0].date.toISOString().slice(0, 10)}`;
  } else if (kind === "leave") {
    const row = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!row) return { ok: false, message: dict.history.notFound };
    await prisma.leaveRequest.delete({ where: { id } });
    userId = row.requesterId;
    detail = `leave ${row.type} ${row.startDate.toISOString().slice(0, 10)}–${row.endDate.toISOString().slice(0, 10)} (${row.status})`;
  } else if (kind === "attest") {
    const row = await prisma.timeAttestation.findUnique({ where: { id } });
    if (!row) return { ok: false, message: dict.history.notFound };
    await prisma.timeAttestation.delete({ where: { id } });
    userId = row.requesterId;
    detail = `attest ${row.type} ${row.date.toISOString().slice(0, 10)} (${row.status})`;
  } else {
    const row = await prisma.lessonPlan.findUnique({ where: { id }, include: { course: { select: { code: true } } } });
    if (!row) return { ok: false, message: dict.history.notFound };
    await prisma.lessonPlan.delete({ where: { id } });
    userId = row.teacherId;
    detail = `lessonPlan ${row.course?.code ?? "?"} ${row.fileName} (${row.status})`;
  }

  await logAudit({ action: "RECORD_DELETED", actorId: session.user.id, targetUserId: userId, ip, detail });
  revalidateAll(userId);
  return { ok: true, message: dict.history.deletedOne };
}

/** Delete every record of one kind for one person. */
export async function clearRecords(kind: RecordKind, userId: string): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());
  const ip = getClientIp();
  let count = 0;

  if (kind === "attendance") {
    count = (await deleteAttendanceRows({ userId })).length;
  } else if (kind === "leave") {
    count = (await prisma.leaveRequest.deleteMany({ where: { requesterId: userId } })).count;
  } else if (kind === "attest") {
    count = (await prisma.timeAttestation.deleteMany({ where: { requesterId: userId } })).count;
  } else {
    count = (await prisma.lessonPlan.deleteMany({ where: { teacherId: userId } })).count;
  }

  await logAudit({ action: "RECORD_DELETED", actorId: session.user.id, targetUserId: userId, ip, detail: `clear ${kind}: ${count} rows` });
  revalidateAll(userId);
  return { ok: true, message: dict.history.deletedMany(count) };
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ATTENDANCE_STATUSES = ["PENDING", "ON_TIME", "LATE", "ABSENT", "LEAVE"] as const;
export type AttendanceStatusValue = (typeof ATTENDANCE_STATUSES)[number];

/**
 * Admin corrects a day's attendance in place (a wrong tap, a phone that
 * died at 17:00) instead of deleting the whole row. Times are "HH:MM" on
 * the row's own date in Thailand time; empty clears the stamp. Marked
 * attested*=true so the report can tell an admin edit from a real
 * GPS/biometric tap; the before/after goes to the audit log.
 */
export async function updateAttendance(
  id: string,
  input: { checkin: string; checkout: string; status: AttendanceStatusValue }
): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());
  const row = await prisma.attendance.findUnique({ where: { id } });
  if (!row) return { ok: false, message: dict.history.notFound };

  const checkin = input.checkin.trim();
  const checkout = input.checkout.trim();
  if ((checkin && !TIME_RE.test(checkin)) || (checkout && !TIME_RE.test(checkout))) {
    return { ok: false, message: dict.history.invalidTime };
  }
  if (checkin && checkout && checkout <= checkin) return { ok: false, message: dict.history.checkoutBeforeCheckin };
  if (!ATTENDANCE_STATUSES.includes(input.status)) return { ok: false, message: dict.history.invalidStatus };

  const day = new Date(row.date);
  day.setHours(0, 0, 0, 0);
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(day);
    d.setHours(h, m, 0, 0);
    return d;
  };
  // Compare at minute precision in Thai time so an untouched field (whose
  // stored value has seconds) isn't counted as an edit.
  const hhmm = (d: Date | null) =>
    d ? new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }) : "";
  const inChanged = hhmm(row.checkinAt) !== checkin;
  const outChanged = hhmm(row.checkoutAt) !== checkout;
  const nextIn = inChanged ? (checkin ? at(checkin) : null) : row.checkinAt;
  const nextOut = outChanged ? (checkout ? at(checkout) : null) : row.checkoutAt;

  const changes: string[] = [];
  if (inChanged) changes.push(`in: ${hhmm(row.checkinAt) || "—"} → ${checkin || "—"}`);
  if (outChanged) changes.push(`out: ${hhmm(row.checkoutAt) || "—"} → ${checkout || "—"}`);
  if (row.status !== input.status) changes.push(`status: ${row.status} → ${input.status}`);
  if (changes.length === 0) return { ok: true, message: dict.history.unchanged };

  await prisma.attendance.update({
    where: { id },
    data: {
      checkinAt: nextIn,
      checkoutAt: nextOut,
      status: input.status,
      attestedCheckin: row.attestedCheckin || inChanged,
      attestedCheckout: row.attestedCheckout || outChanged,
    },
  });
  await logAudit({
    action: "RECORD_EDITED",
    actorId: session.user.id,
    targetUserId: row.userId,
    ip: getClientIp(),
    detail: `attendance ${row.date.toISOString().slice(0, 10)}: ${changes.join("; ")}`,
  });
  revalidateAll(row.userId);
  return { ok: true, message: dict.history.edited };
}
