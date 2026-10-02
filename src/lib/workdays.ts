import { prisma } from "./prisma";
import { parseWeekdays } from "./automation";
import { pickedDateKey } from "./date";
import { eventSiteIds, keyToDate } from "./calendar";

/**
 * Work calendar: which days count as work days for a teacher.
 *
 *  - weekdays : AppSetting.remindWeekdays (0 = Mon … 6 = Sun; default Mon–Fri),
 *               edited in Master Data → "วันทำงาน"
 *  - holidays : SchoolEvent rows with isHoliday (ปฏิทินโรงเรียน) — school-wide
 *               (no sites) or for the listed sites; a teacher follows their
 *               PRIMARY site.
 *
 * Used for leave day counting, LEAVE rows on approval, automatic ABSENT and
 * the monthly report. Day keys are "YYYY-MM-DD" (picked-date convention).
 */
export type WorkCalendar = {
  weekdays: Set<number>;
  /** siteIds [] = every school. */
  holidays: { from: string; to: string; siteIds: string[]; title: string }[];
};

export async function loadWorkCalendar(fromKey: string, toKey: string): Promise<WorkCalendar> {
  const [setting, events] = await Promise.all([
    prisma.appSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: {}, select: { remindWeekdays: true } }),
    prisma.schoolEvent.findMany({
      where: { isHoliday: true, startDate: { lte: keyToDate(toKey) }, endDate: { gte: keyToDate(fromKey) } },
      select: { startDate: true, endDate: true, siteIds: true, campusLocationId: true, title: true },
    }),
  ]);
  return {
    weekdays: new Set(parseWeekdays(setting.remindWeekdays)),
    holidays: events.map((e) => ({ from: pickedDateKey(e.startDate), to: pickedDateKey(e.endDate), siteIds: eventSiteIds(e), title: e.title })),
  };
}

/** 0 = Mon … 6 = Sun for a day key. */
export function weekdayOfKey(key: string) {
  return (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The holiday covering `key` for a school (null site = school-wide holidays only). */
export function holidayFor(cal: WorkCalendar, key: string, siteId: string | null | undefined) {
  return cal.holidays.find((h) => h.from <= key && key <= h.to && (h.siteIds.length === 0 || (!!siteId && h.siteIds.includes(siteId)))) ?? null;
}

export function isWorkday(cal: WorkCalendar, key: string, siteId: string | null | undefined) {
  return cal.weekdays.has(weekdayOfKey(key)) && !holidayFor(cal, key, siteId);
}

/** Every day key from `fromKey` to `toKey` inclusive. */
export function eachDayKey(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${fromKey}T00:00:00Z`), end = Date.parse(`${toKey}T00:00:00Z`); t <= end && out.length < 1000; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function countWorkdays(cal: WorkCalendar, fromKey: string, toKey: string, siteId: string | null | undefined) {
  return eachDayKey(fromKey, toKey).filter((k) => isWorkday(cal, k, siteId)).length;
}
