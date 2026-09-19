"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AttestType, RequestStatus } from "@prisma/client";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * FR-13: request a manual time attestation for a day the teacher forgot to
 * check in/out. "ลืมทั้งสองอย่าง" (forgot both) needs TWO times — a check-in
 * and a check-out — not one, since those are two separate real-world events.
 */
export async function requestAttestation(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("Unauthorized");

  const type = formData.get("type") as AttestType;
  const time = (formData.get("time") as string) || "";
  const time2 = (formData.get("time2") as string) || "";

  if (!TIME_RE.test(time)) {
    return { ok: false, message: type === "FORGOT_CHECKOUT" ? "กรอกเวลาเช็คเอาต์ให้ถูกต้อง (HH:MM)" : "กรอกเวลาเช็คอินให้ถูกต้อง (HH:MM)" };
  }
  if (type === "FORGOT_BOTH") {
    if (!TIME_RE.test(time2)) {
      return { ok: false, message: "กรอกเวลาเช็คเอาต์ให้ถูกต้อง (HH:MM)" };
    }
    if (time2 <= time) {
      return { ok: false, message: "เวลาเช็คเอาต์ต้องอยู่หลังเวลาเช็คอิน" };
    }
  }

  await prisma.timeAttestation.create({
    data: {
      requesterId: session.user.id,
      date: new Date(formData.get("date") as string),
      type,
      requestedTime: time,
      requestedCheckoutTime: type === "FORGOT_BOTH" ? time2 : null,
      reason: formData.get("reason") as string,
    },
  });

  revalidatePath("/attest");
  return { ok: true, message: "ส่งคำขอรับรองเวลาแล้ว" };
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

  const req = await prisma.timeAttestation.update({
    where: { id },
    data: { status: decision as RequestStatus, approverId: session.user.id, decidedAt: new Date() },
  });

  if (decision === "APPROVED") {
    const date = new Date(req.date);
    date.setHours(0, 0, 0, 0);

    function atTime(hhmm: string) {
      const [h, m] = hhmm.split(":").map(Number);
      const d = new Date(date);
      d.setHours(h, m);
      return d;
    }

    // "ลืมทั้งสองอย่าง" (forgot both) has two distinct real times — check-in
    // and check-out — recorded separately (requestedTime / requestedCheckoutTime),
    // not the same moment applied to both.
    const data: Record<string, unknown> = {};
    if (req.type !== "FORGOT_CHECKOUT") {
      data.checkinAt = atTime(req.requestedTime);
      data.attestedCheckin = true;
      data.status = "ON_TIME";
    }
    if (req.type !== "FORGOT_CHECKIN") {
      data.checkoutAt = atTime(req.type === "FORGOT_BOTH" ? req.requestedCheckoutTime! : req.requestedTime);
      data.attestedCheckout = true;
    }

    await prisma.attendance.upsert({
      where: { userId_date: { userId: req.requesterId, date } },
      create: { userId: req.requesterId, date, ...data },
      update: data,
    });
  }

  revalidatePath("/attest");
  revalidatePath("/checkin");
  revalidatePath("/dashboard");
}
