import { prisma } from "./prisma";

// Kept out of the "use server" actions module on purpose: anything exported
// from there is a callable POST endpoint, and these take any user id.

/**
 * True when this teacher has an APPROVED half-day PM leave for `date` — that
 * leave keeps the real check-in/out record (see decideLeave in
 * src/actions/leave.ts), so checking out before the site's workEnd on that
 * day is expected, not an "early checkout" worth flagging to Admin.
 * LeaveRequest.startDate is stored as a raw UTC-midnight parse of the
 * "YYYY-MM-DD" form input, not Bangkok-local midnight like Attendance.date —
 * normalizing with the same `setHours(0,0,0,0)` decideLeave uses before
 * writing LEAVE rows keeps the comparison correct either way.
 */
export async function hasApprovedPmHalfDayLeave(userId: string, date: Date): Promise<boolean> {
  return (await approvedHalfDayLeave(userId, date)) === "PM";
}

/** "AM" / "PM" when this person has an approved half-day leave on `date` (Bangkok midnight), else null. */
export async function approvedHalfDayLeave(userId: string, date: Date): Promise<"AM" | "PM" | null> {
  const leaves = await prisma.leaveRequest.findMany({
    where: { requesterId: userId, status: "APPROVED", halfDay: { in: ["AM", "PM"] }, startDate: { gte: new Date(+date - 2 * 86_400_000), lte: new Date(+date + 2 * 86_400_000) } },
    select: { startDate: true, halfDay: true },
  });
  const hit = leaves.find((r) => {
    const d = new Date(r.startDate);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === date.getTime();
  });
  return hit ? (hit.halfDay as "AM" | "PM") : null;
}
