import { prisma } from "./prisma";

/**
 * School calendar ("ปฏิทินโรงเรียน"). Event dates are picked dates, stored
 * as UTC midnight of the day (like Semester), both ends inclusive — so a
 * "YYYY-MM-DD" key compares directly against them.
 */

export function keyToDate(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Holidays on one day: `all` = a school-wide holiday (no site), `sites` =
 * the schools with their own holiday that day.
 */
export async function holidaysOn(dateKey: string): Promise<{ all: boolean; sites: Set<string> }> {
  const d = keyToDate(dateKey);
  const rows = await prisma.schoolEvent.findMany({
    where: { isHoliday: true, startDate: { lte: d }, endDate: { gte: d } },
    select: { campusLocationId: true },
  });
  return {
    all: rows.some((r) => r.campusLocationId === null),
    sites: new Set(rows.map((r) => r.campusLocationId).filter((x): x is string => !!x)),
  };
}

/** Whether a teacher stationed at `siteId` has the day off. */
export function isHolidayFor(h: { all: boolean; sites: Set<string> }, siteId: string | null | undefined) {
  return h.all || (!!siteId && h.sites.has(siteId));
}
