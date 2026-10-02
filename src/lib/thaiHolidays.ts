/**
 * Starting list of Thai public holidays for one year ("ดึงวันหยุดราชการ").
 *
 * Only the fixed-date holidays get a date here. Buddhist holidays follow the
 * lunar calendar and the cabinet announces substitute / special days every
 * year, so those come with an empty date for the Admin to fill in from the
 * official announcement — nothing here is presented as authoritative.
 * Substitute days are *suggested* by the usual rule (a holiday on Sat/Sun →
 * the next working weekday) and flagged so the Admin double-checks them.
 */
export type HolidayPreset = {
  key: string; // dictionary key for the name (calendarTools.holidayNames)
  start: string; // "YYYY-MM-DD", "" = Admin must fill in (lunar)
  end: string;
  lunar?: boolean;
  substituteFor?: string; // key of the holiday this one substitutes
  optional?: boolean; // not usually a school holiday — unchecked by default
};

const FIXED: { key: string; md: string; days?: number; optional?: boolean }[] = [
  { key: "newYear", md: "01-01" },
  { key: "chakri", md: "04-06" },
  { key: "songkran", md: "04-13", days: 3 },
  { key: "labour", md: "05-01", optional: true },
  { key: "coronation", md: "05-04" },
  { key: "queenSuthida", md: "06-03" },
  { key: "kingBirthday", md: "07-28" },
  { key: "motherDay", md: "08-12" },
  { key: "kingBhumibolMemorial", md: "10-13" },
  { key: "chulalongkorn", md: "10-23" },
  { key: "fatherDay", md: "12-05" },
  { key: "constitution", md: "12-10" },
  { key: "newYearEve", md: "12-31" },
];
const LUNAR = ["makhaBucha", "visakhaBucha", "asalhaBucha", "khaoPhansa"];

const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay(); // 0 = Sun

export function thaiHolidayPresets(year: number): HolidayPreset[] {
  const out: HolidayPreset[] = [];
  const taken = new Set<string>();
  for (const f of FIXED) {
    const start = `${year}-${f.md}`;
    const end = addDays(start, (f.days ?? 1) - 1);
    out.push({ key: f.key, start, end, optional: f.optional });
    for (let k = start; k <= end; k = addDays(k, 1)) taken.add(k);
  }
  for (const k of LUNAR) out.push({ key: k, start: "", end: "", lunar: true });

  // Next year's New Year's Day is taken too (a 31 Dec substitute must not land on it).
  taken.add(`${year + 1}-01-01`);
  // Suggested substitute days: one per holiday day that falls on a weekend,
  // on the next weekday after the holiday that isn't already a holiday.
  for (const h of out.filter((x) => !x.lunar && !x.optional)) {
    let weekendDays = 0;
    for (let k = h.start; k <= h.end; k = addDays(k, 1)) if (dow(k) === 0 || dow(k) === 6) weekendDays++;
    let k = h.end;
    while (weekendDays > 0) {
      k = addDays(k, 1);
      if (dow(k) === 0 || dow(k) === 6 || taken.has(k)) continue;
      taken.add(k);
      out.push({ key: h.key, start: k, end: k, substituteFor: h.key });
      weekendDays--;
    }
  }
  return out.sort((a, b) => (a.start || "9999").localeCompare(b.start || "9999"));
}
