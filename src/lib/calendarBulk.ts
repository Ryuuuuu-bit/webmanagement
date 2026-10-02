import { prisma } from "./prisma";
import { eventSiteIds, isDateKey, keyToDate } from "./calendar";
import { getDictionary } from "./i18n/dictionaries";
import { pickedDateKey } from "./date";
import type { Dictionary } from "./i18n/dictionaries";

type Msgs = Dictionary["actions"]["schoolCalendar"];

/**
 * Bulk school-calendar operations (Excel/CSV import, public-holiday presets,
 * copy a year). Server actions in src/actions/calendar.ts wrap these with the
 * Admin check and cache revalidation.
 */

/**
 * One event to add. `siteIds` (when given) names the schools directly — the
 * holiday picker and the "same for every row" choice use it; otherwise
 * `schools` is matched by name ([] / blank / "all" = every school).
 */
export type BulkEventRow = { row: number; title: string; start: string; end: string; holiday: boolean; schools: string; detail: string; siteIds?: string[] };
export type BulkEventResult = { row: number; title: string; ok: boolean; message: string };

// Words meaning "every school" — incl. the label the Excel export writes in either language.
const ALL_WORDS = new Set(
  ["", "all", "*", "ทุกโรงเรียน", "ทั้งหมด", "ทุกสาขา", "ทุก site", "ทุกที่", getDictionary("th").schoolCalendar.allSchools, getDictionary("en").schoolCalendar.allSchools].map((w) =>
    w.trim().toLowerCase()
  )
);

/**
 * Creates many events at once — the Excel/CSV import (rows already mapped
 * and date-parsed in the browser) and the public-holiday picker both use
 * it. `schools` is a comma/semicolon/newline separated list of school
 * names, or blank / "ทุกโรงเรียน" / "all" for every school. A row with the
 * same title, dates and schools as an existing event updates that event
 * (holiday flag / details) instead of adding a duplicate, so re-importing a
 * corrected sheet is safe.
 */
export async function importEventRows(rows: BulkEventRow[], actorId: string, t: Msgs): Promise<{ ok: boolean; message: string; results: BulkEventResult[] }> {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, message: t.importEmpty, results: [] };
  if (rows.length > 1000) return { ok: false, message: t.importTooMany, results: [] };

  const sites = await prisma.campusLocation.findMany({ select: { id: true, name: true } });
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  // name → id, or null when two schools share the name (then only ids can pick them).
  const siteByName = new Map<string, string | null>();
  for (const x of sites) siteByName.set(norm(x.name), siteByName.has(norm(x.name)) ? null : x.id);
  const knownIds = new Set(sites.map((x) => x.id));

  const results: BulkEventResult[] = [];
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const title = String(r.title ?? "").trim().slice(0, 200);
    const base = { row: Number(r.row) || 0, title };
    const from = String(r.start ?? "").trim();
    const to = String(r.end ?? "").trim() || from;
    if (!title) {
      results.push({ ...base, ok: false, message: t.fillRequired });
      continue;
    }
    if (!isDateKey(from) || !isDateKey(to)) {
      results.push({ ...base, ok: false, message: t.invalidDates });
      continue;
    }
    if (to < from) {
      results.push({ ...base, ok: false, message: t.endBeforeStart });
      continue;
    }
    if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) {
      results.push({ ...base, ok: false, message: t.tooLong });
      continue;
    }
    let siteIds: string[];
    if (Array.isArray(r.siteIds)) {
      // Picked by id (holiday picker / "same for every row"): must all exist.
      siteIds = Array.from(new Set(r.siteIds.map(String))).sort();
      if (siteIds.some((id) => !knownIds.has(id))) {
        results.push({ ...base, ok: false, message: t.unknownSchools(siteIds.filter((id) => !knownIds.has(id)).join(", ")) });
        continue;
      }
    } else {
      const raw = String(r.schools ?? "").trim();
      // A whole cell equal to one school's name wins over splitting (names may contain "," or "/").
      const names = siteByName.has(norm(raw)) ? [raw] : raw.split(/[,;\n/|]+/).map((x) => x.trim()).filter((x) => !ALL_WORDS.has(norm(x)));
      const unknown = names.filter((n) => !siteByName.has(norm(n)));
      if (unknown.length) {
        results.push({ ...base, ok: false, message: t.unknownSchools(unknown.join(", ")) });
        continue;
      }
      const ambiguous = names.filter((n) => siteByName.get(norm(n)) === null);
      if (ambiguous.length) {
        results.push({ ...base, ok: false, message: t.ambiguousSchools(ambiguous.join(", ")) });
        continue;
      }
      siteIds = Array.from(new Set(names.map((n) => siteByName.get(norm(n))!))).sort();
    }
    const detail = String(r.detail ?? "").trim().slice(0, 2000) || null;

    const same = await prisma.schoolEvent.findMany({
      where: { title, startDate: keyToDate(from), endDate: keyToDate(to) },
      select: { id: true, siteIds: true, campusLocationId: true },
    });
    const match = same.find((e) => eventSiteIds(e).sort().join(",") === siteIds.join(","));
    if (match) {
      await prisma.schoolEvent.update({ where: { id: match.id }, data: { isHoliday: !!r.holiday, ...(detail ? { detail } : {}) } });
      results.push({ ...base, ok: true, message: t.importUpdated });
      updated++;
    } else {
      await prisma.schoolEvent.create({
        data: { title, detail, startDate: keyToDate(from), endDate: keyToDate(to), isHoliday: !!r.holiday, siteIds, createdById: actorId },
      });
      results.push({ ...base, ok: true, message: t.importCreated });
      created++;
    }
  }
  const failed = results.filter((x) => !x.ok).length;
  return { ok: created + updated > 0, message: t.importDone(created, updated, failed), results };
}

/**
 * "คัดลอกจากปีที่แล้ว": every event starting in `fromYear` (optionally only
 * those touching one school) is copied one year later — same month/day,
 * 29 Feb → 28 Feb. Events already present in the target year with the same
 * title and start date are skipped, so running it twice is harmless.
 * Lunar holidays and substitute days move every year: the result message
 * tells the Admin to check them.
 */
export async function copyEventsToNextYear(fromYear: number, siteId: string | null, actorId: string, t: Msgs): Promise<{ ok: boolean; message: string }> {
  if (!Number.isInteger(fromYear) || fromYear < 2000 || fromYear > 2200) return { ok: false, message: t.invalidDates };
  const events = await prisma.schoolEvent.findMany({
    where: { startDate: { gte: keyToDate(`${fromYear}-01-01`), lte: keyToDate(`${fromYear}-12-31`) } },
  });
  const shift = (d: Date) => {
    const key = pickedDateKey(d);
    const [y, m, day] = key.split("-").map(Number);
    const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
    return keyToDate(`${y + 1}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`);
  };
  let copied = 0;
  let skipped = 0;
  for (const e of events) {
    const all = eventSiteIds(e);
    if (siteId && all.length > 0 && !all.includes(siteId)) continue;
    // Copying for one school copies that school's share only (its own events
    // and school-wide ones stay as they are; a multi-school event becomes this school's).
    const sites = siteId && all.length > 0 ? [siteId] : all;
    const startDate = shift(e.startDate);
    const same = await prisma.schoolEvent.findMany({ where: { title: e.title, startDate }, select: { siteIds: true, campusLocationId: true } });
    const key = [...sites].sort().join(",");
    if (same.some((x) => eventSiteIds(x).sort().join(",") === key)) {
      skipped++;
      continue;
    }
    await prisma.schoolEvent.create({
      data: { title: e.title, detail: e.detail, isHoliday: e.isHoliday, siteIds: sites, startDate, endDate: shift(e.endDate), createdById: actorId },
    });
    copied++;
  }
  return { ok: copied > 0, message: t.copied(copied, skipped, fromYear + 1) };
}
