import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * School calendar ("ปฏิทินโรงเรียน"). Event dates are picked dates, stored
 * as UTC midnight of the day (like Semester), both ends inclusive — so a
 * "YYYY-MM-DD" key compares directly against them. An event applies to the
 * schools in siteIds, or to every school when there are none.
 */

export function keyToDate(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The schools an event applies to ([] = every school), merging the legacy single-school column. */
export function eventSiteIds(e: { siteIds: string[]; campusLocationId: string | null }): string[] {
  return Array.from(new Set([...e.siteIds, ...(e.campusLocationId ? [e.campusLocationId] : [])]));
}

/** Prisma filter: events visible to anyone at one of `siteIds` (their schools' events + school-wide ones). */
export function eventsForSites(siteIds: string[]): Prisma.SchoolEventWhereInput {
  return {
    OR: [
      { siteIds: { isEmpty: true }, campusLocationId: null },
      ...(siteIds.length ? [{ siteIds: { hasSome: siteIds } }, { campusLocationId: { in: siteIds } }] : []),
    ],
  };
}

/**
 * Holidays on one day: `all` = a school-wide holiday, `sites` = the schools
 * with their own holiday that day.
 */
export async function holidaysOn(dateKey: string): Promise<{ all: boolean; sites: Set<string> }> {
  const d = keyToDate(dateKey);
  const rows = await prisma.schoolEvent.findMany({
    where: { isHoliday: true, startDate: { lte: d }, endDate: { gte: d } },
    select: { siteIds: true, campusLocationId: true },
  });
  const sites = rows.map(eventSiteIds);
  return { all: sites.some((x) => x.length === 0), sites: new Set(sites.flat()) };
}

/** Whether a teacher stationed at `siteId` has the day off. */
export function isHolidayFor(h: { all: boolean; sites: Set<string> }, siteId: string | null | undefined) {
  return h.all || (!!siteId && h.sites.has(siteId));
}
