import { prisma } from "./prisma";

/**
 * Is a check-in attestation (FORGOT_CHECKIN / FORGOT_BOTH) for `day` already
 * waiting on an admin? `day` is Attendance-style local (Bangkok) midnight;
 * TimeAttestation.date is the raw "YYYY-MM-DD" form value parsed as UTC
 * midnight, which falls inside that same local day — so match by range.
 */
export async function hasPendingCheckinAttestation(userId: string, day: Date): Promise<boolean> {
  const end = new Date(day.getTime() + 24 * 60 * 60 * 1000);
  const row = await prisma.timeAttestation.findFirst({
    where: { requesterId: userId, status: "PENDING", type: { in: ["FORGOT_CHECKIN", "FORGOT_BOTH"] }, date: { gte: day, lt: end } },
    select: { id: true },
  });
  return !!row;
}
