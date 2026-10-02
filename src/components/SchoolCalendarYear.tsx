"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useLanguage } from "./LanguageProvider";
import { monthGrid, type SchoolEventRow } from "./SchoolCalendar";

type SummaryRow = { siteId: string; name: string; workdays: number; holidays: number; weekendDays: number };

const daysIn = (e: SchoolEventRow) => Math.round((Date.parse(e.end) - Date.parse(e.start)) / 86_400_000) + 1;

/**
 * Whole-year view: 12 mini months (holidays red, other events marked), the
 * year's event list, work days / holidays per school, and an Excel export
 * whose event sheet uses the same columns as the import — so a year can be
 * exported, edited in Excel and imported back.
 */
export default function SchoolCalendarYear({
  year,
  todayKey,
  events,
  summary,
  siteFilter,
  isAdmin,
}: {
  year: number;
  todayKey: string;
  events: SchoolEventRow[];
  summary: SummaryRow[];
  siteFilter: string;
  isAdmin: boolean;
}) {
  const { dict, locale } = useLanguage();
  const t = dict.schoolCalendar;
  const intl = locale === "en" ? "en-US" : "th-TH";
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const schools = (e: SchoolEventRow) => (e.siteIds.length === 0 ? t.allSchools : e.siteNames.join(", "));
  const fmt = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString(intl, { day: "numeric", month: "short", timeZone: "UTC" });
  const siteQ = siteFilter ? `&site=${siteFilter}` : "";

  const dayInfo = useMemo(() => {
    const map = new Map<string, { holiday: boolean; event: boolean; titles: string[] }>();
    for (const e of events) {
      for (let k = e.start; k <= e.end; k = new Date(Date.parse(`${k}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
        const cur = map.get(k) ?? { holiday: false, event: false, titles: [] };
        if (e.isHoliday) cur.holiday = true;
        else cur.event = true;
        cur.titles.push(e.title);
        map.set(k, cur);
      }
    }
    return map;
  }, [events]);

  const inYear = events.filter((e) => e.end >= `${year}-01-01` && e.start <= `${year}-12-31`);

  async function exportExcel() {
    const XLSX = await import("xlsx");
    const x = dict.calendarTools;
    const evSheet = XLSX.utils.aoa_to_sheet([
      [x.fields.title, x.fields.start, x.fields.end, x.fields.holiday, x.fields.schools, x.fields.detail, x.colDays],
      ...inYear.map((e) => [e.title, e.start, e.end, e.isHoliday ? x.yes : x.no, e.siteIds.length === 0 ? t.allSchools : e.siteNames.join(", "), e.detail ?? "", daysIn(e)]),
    ]);
    evSheet["!cols"] = [{ wch: 34 }, { wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 30 }, { wch: 30 }, { wch: 8 }];
    const sumSheet = XLSX.utils.aoa_to_sheet([
      [x.colSchool, x.colWorkdays, x.colHolidays, x.colWeekend],
      ...summary.map((s) => [s.name, s.workdays, s.holidays, s.weekendDays]),
    ]);
    sumSheet["!cols"] = [{ wch: 30 }, { wch: 14 }, { wch: 22 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, evSheet, x.sheetEvents);
    XLSX.utils.book_append_sheet(wb, sumSheet, x.sheetSummary);
    XLSX.writeFile(wb, `school-calendar-${year}.xlsx`);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href={`/calendar?view=year&year=${year - 1}${siteQ}`} className="rounded-lg border border-line px-3 py-1.5 text-sm text-subtle hover:bg-line-soft" aria-label={t.prevYear}>‹</Link>
          <h2 className="text-base font-bold">{t.yearTitle(locale === "th" ? year + 543 : year)}</h2>
          <Link href={`/calendar?view=year&year=${year + 1}${siteQ}`} className="rounded-lg border border-line px-3 py-1.5 text-sm text-subtle hover:bg-line-soft" aria-label={t.nextYear}>›</Link>
        </div>
        <button type="button" onClick={exportExcel} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand-ink hover:bg-line-soft">
          {dict.calendarTools.export}
        </button>
      </div>

      {summary.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h3 className="text-sm font-bold">{t.summaryTitle}</h3>
          <p className="mb-2 text-xs text-muted">{t.summaryHint}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-0 text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="pb-1.5">{dict.calendarTools.colSchool}</th>
                  <th className="pb-1.5 text-right">{dict.calendarTools.colWorkdays}</th>
                  <th className="pb-1.5 text-right">{dict.calendarTools.colHolidays}</th>
                  <th className="pb-1.5 text-right">{dict.calendarTools.colWeekend}</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.siteId} className="border-t border-line-soft">
                    <td className="py-1.5">{s.name}</td>
                    <td className="py-1.5 text-right font-semibold text-ok">{s.workdays}</td>
                    <td className="py-1.5 text-right font-semibold text-danger">{s.holidays}</td>
                    <td className="py-1.5 text-right text-faint">{s.weekendDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {months.map((m) => (
          <Link key={m} href={`/calendar?month=${m}${siteQ}`} className="rounded-2xl border border-line bg-surface p-3 shadow-sm hover:border-brand">
            <div className="mb-1.5 text-sm font-semibold">
              {new Date(`${m}-01T00:00:00Z`).toLocaleDateString(intl, { month: "long", timeZone: "UTC" })}
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px]">
              {dict.day.mini.map((d) => (
                <span key={d} className="text-faint">{d}</span>
              ))}
              {monthGrid(m).map((k) => {
                const info = dayInfo.get(k);
                const inMonth = k.slice(0, 7) === m;
                if (!inMonth) return <span key={k} />;
                return (
                  <span
                    key={k}
                    title={info?.titles.join(" · ")}
                    className={`rounded py-0.5 ${info?.holiday ? "bg-danger text-white" : info?.event ? "bg-info-soft text-info" : "text-subtle"} ${k === todayKey ? "ring-1 ring-brand" : ""}`}
                  >
                    {Number(k.slice(8))}
                  </span>
                );
              })}
            </div>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h3 className="mb-2 text-sm font-bold">{t.eventsInYear(inYear.length)}</h3>
        {inYear.length === 0 && <p className="text-sm text-faint">{isAdmin ? t.emptyYearAdmin : t.empty}</p>}
        <ul className="flex flex-col">
          {inYear.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line-soft py-2 text-sm first:border-t-0">
              <span className="w-32 flex-none text-xs text-muted">{e.start === e.end ? fmt(e.start) : `${fmt(e.start)} – ${fmt(e.end)}`}</span>
              <span className="font-medium">{e.title}</span>
              {e.isHoliday && <span className="badge bg-danger-soft text-danger">{t.holiday}</span>}
              <span className="text-xs text-faint">{schools(e)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
