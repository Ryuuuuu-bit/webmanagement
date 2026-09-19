"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AttestType, RequestStatus } from "@prisma/client";

/** FR-13: request a manual time attestation for a day the teacher forgot to check in/out. */
export async function requestAttestation(formData: FormData) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("Unauthorized");

  await prisma.timeAttestation.create({
    data: {
      requesterId: session.user.id,
      date: new Date(formData.get("date") as string),
      type: formData.get("type") as AttestType,
      requestedTime: formData.get("time") as string,
      reason: formData.get("reason") as string,
    },
  });

  revalidatePath("/attest");
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
    const [h, m] = req.requestedTime.split(":").map(Number);
    const attestedAt = new Date(date);
    attestedAt.setHours(h, m);

    const data: Record<string, unknown> = {};
    if (req.type !== "FORGOT_CHECKOUT") {
      data.checkinAt = attestedAt;
      data.attestedCheckin = true;
      data.status = "ON_TIME";
    }
    if (req.type !== "FORGOT_CHECKIN") {
      data.checkoutAt = attestedAt;
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
