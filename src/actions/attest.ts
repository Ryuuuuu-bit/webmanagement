"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AttestType, RequestStatus } from "@prisma/client";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { notifyAdmins, notifyUser } from "@/lib/notify";
import { atTimeOfDay, getWorkHoursForUser } from "@/lib/settings";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * FR-13: request a manual time attestation for a day the teacher forgot to
 * check in/out. "ลืมทั้งสองอย่าง" (forgot both) needs TWO times — a check-in
 * and a check-out — not one, since those are two separate real-world events.
 */
export async function requestAttestation(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("Unauthorized");
  const dict = getDictionary(getLocale());

  const type = formData.get("type") as AttestType;
  const time = (formData.get("time") as string) || "";
  const time2 = (formData.get("time2") as string) || "";
  const date = new Date(formData.get("date") as string);
  if (isNaN(date.getTime())) return { ok: false, message: dict.actions.attest.invalidDate };
  if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) return { ok: false, message: dict.actions.attest.futureDate };
  if (!["FORGOT_CHECKIN", "FORGOT_CHECKOUT", "FORGOT_BOTH"].includes(type)) return { ok: false, message: dict.actions.attest.invalidDate };

  if (!TIME_RE.test(time)) {
    return {
      ok: false,
      message: type === "FORGOT_CHECKOUT" ? dict.actions.attest.invalidCheckoutTime : dict.actions.attest.invalidCheckinTime,
    };
  }
  if (type === "FORGOT_BOTH") {
    if (!TIME_RE.test(time2)) {
      return { ok: false, message: dict.actions.attest.invalidCheckoutTime };
    }
    if (time2 <= time) {
      return { ok: false, message: dict.actions.attest.checkoutBeforeCheckin };
    }
  }

  // A forgotten check-in on a day with a real check-out (the "checked out
  // without checking in" flow): the claimed arrival must come before it.
  if (type === "FORGOT_CHECKIN") {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const att = await prisma.attendance.findUnique({
      where: { userId_date: { userId: session.user.id, date: day } },
      select: { checkoutAt: true, attestedCheckout: true },
    });
    if (att?.checkoutAt && !att.attestedCheckout) {
      const out = att.checkoutAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
      if (time >= out) return { ok: false, message: dict.actions.attest.checkinAfterRealCheckout(out) };
    }
  }

  const created = await prisma.timeAttestation.create({
    data: {
      requesterId: session.user.id,
      date,
      type,
      requestedTime: time,
      requestedCheckoutTime: type === "FORGOT_BOTH" ? time2 : null,
      reason: formData.get("reason") as string,
    },
  });

  const requester = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } });
  await notifyAdmins(
    "ATTEST_REQUESTED",
    {
      requesterName: requester?.name ?? session.user.name ?? "-",
      type,
      date: created.date.toISOString(),
      time: type === "FORGOT_BOTH" ? `${time}–${time2}` : time,
    },
    "/attest",
    { excludeUserId: session.user.id }
  );

  revalidatePath("/attest");
  revalidatePath("/checkin");
  revalidatePath("/dashboard");
  return { ok: true, message: dict.actions.attest.submitted };
}

/**
 * FR-13.2 / 13.3: Admin decides a request. On approval, the day's
 * attendance is updated but flagged `attested*` — kept distinct from a real
 * GPS-verified check-in/out for later audit (FR-11).
 */
export async function decideAttestation(id: string, decision: "APPROVED" | "REJECTED") {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }
  const dict = getDictionary(getLocale());

  // Only a pending request can be decided (stale tab / double click / a
  // second admin) — never flip a decided one.
  const claimed = await prisma.timeAttestation.updateMany({
    where: { id, status: "PENDING" },
    data: { status: decision as RequestStatus, approverId: session.user.id, decidedAt: new Date() },
  });
  if (claimed.count === 0) {
    revalidatePath("/attest");
    return;
  }
  const req = await prisma.timeAttestation.findUniqueOrThrow({ where: { id }, include: { approver: { select: { name: true } } } });

  if (decision === "APPROVED") {
    const date = new Date(req.date);
    date.setHours(0, 0, 0, 0);

    function atTime(hhmm: string) {
      const [h, m] = hhmm.split(":").map(Number);
      const d = new Date(date);
      d.setHours(h, m);
      return d;
    }

    const touchesCheckin = req.type !== "FORGOT_CHECKOUT";
    const touchesCheckout = req.type !== "FORGOT_CHECKIN";

    // An attestation fills in a *forgotten* check-in/out — it must never be
    // the thing that overwrites a real GPS-verified time or flips an
    // approved leave day back into a normal workday. Check the existing
    // Attendance row before touching anything; if there's a real conflict,
    // undo the claim above (back to PENDING) and stop, so admin has to
    // resolve it (fix the record, or the leave) before deciding again.
    const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: req.requesterId, date } } });
    const leaveConflict = existing?.status === "LEAVE";
    const attendanceConflict =
      (touchesCheckin && !!existing?.checkinAt && !existing.attestedCheckin) ||
      (touchesCheckout && !!existing?.checkoutAt && !existing.attestedCheckout);

    if (leaveConflict || attendanceConflict) {
      await prisma.timeAttestation.update({ where: { id }, data: { status: "PENDING", approverId: null, decidedAt: null } });
      revalidatePath("/attest");
      throw new Error(leaveConflict ? dict.actions.attest.conflictLeave : dict.actions.attest.conflictAttendance);
    }

    // "ลืมทั้งสองอย่าง" (forgot both) has two distinct real times — check-in
    // and check-out — recorded separately (requestedTime / requestedCheckoutTime),
    // not the same moment applied to both.
    const data: Record<string, unknown> = {};
    if (touchesCheckin) {
      data.checkinAt = atTime(req.requestedTime);
      data.attestedCheckin = true;
      // Same late rule as a real check-in: after the site's start + grace = LATE.
      const hours = await getWorkHoursForUser(req.requesterId);
      const cutoff = new Date(atTimeOfDay(date, hours.start).getTime() + hours.graceMinutes * 60_000);
      data.status = (data.checkinAt as Date) <= cutoff ? "ON_TIME" : "LATE";
    }
    if (touchesCheckout) {
      data.checkoutAt = atTime(req.type === "FORGOT_BOTH" ? req.requestedCheckoutTime! : req.requestedTime);
      data.attestedCheckout = true;
    }

    await prisma.attendance.upsert({
      where: { userId_date: { userId: req.requesterId, date } },
      create: { userId: req.requesterId, date, ...data },
      update: data,
    });
  }

  await notifyUser(
    req.requesterId,
    "ATTEST_DECIDED",
    { decision, type: req.type, date: req.date.toISOString(), approverName: req.approver?.name ?? session.user.name ?? "-" },
    "/attest"
  );

  revalidatePath("/attest");
  revalidatePath("/checkin");
  revalidatePath("/dashboard");
}
