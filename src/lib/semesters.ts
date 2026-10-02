import { prisma } from "./prisma";
import { bangkokDateKey, daysBetweenKeys, pickedDateKey } from "./date";

export type SemesterLite = { id: string; name: string; startDate: Date; endDate: Date; lessonPlanDueDate: Date | null };

/**
 * The semester lesson-plan work is about "right now": the one running
 * today, else the next one to start (plans are usually due before a
 * semester begins), else the most recent one.
 */
export function pickActiveSemester<T extends { startDate: Date; endDate: Date }>(semesters: T[], now = new Date()): T | null {
  const today = bangkokDateKey(now);
  const running = semesters.filter((s) => pickedDateKey(s.startDate) <= today && today <= pickedDateKey(s.endDate));
  if (running.length) return running.sort((a, b) => +b.startDate - +a.startDate)[0];
  const upcoming = semesters.filter((s) => pickedDateKey(s.startDate) > today).sort((a, b) => +a.startDate - +b.startDate);
  if (upcoming.length) return upcoming[0];
  return [...semesters].sort((a, b) => +b.startDate - +a.startDate)[0] ?? null;
}

export async function getActiveSemester(): Promise<SemesterLite | null> {
  const all = await prisma.semester.findMany({ select: { id: true, name: true, startDate: true, endDate: true, lessonPlanDueDate: true } });
  return pickActiveSemester(all);
}

/** Days from today (Bangkok) until the due date: 0 = due today, negative = overdue. */
export function daysUntilDue(due: Date, now = new Date()) {
  return daysBetweenKeys(bangkokDateKey(now), pickedDateKey(due));
}

/** Submitted after the due day ended (Bangkok calendar). */
export function isLate(submittedAt: Date, due: Date | null) {
  return !!due && bangkokDateKey(submittedAt) > pickedDateKey(due);
}
