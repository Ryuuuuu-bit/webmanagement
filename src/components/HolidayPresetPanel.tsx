"use client";

import { useMemo, useState, useTransition } from "react";
import { useLanguage } from "./LanguageProvider";
import { SitePicker } from "./SchoolCalendar";
import { ResultBox } from "./CalendarImport";
import { thaiHolidayPresets } from "@/lib/thaiHolidays";
import type { BulkEventResult, BulkEventRow } from "@/actions/calendar";

type Item = { id: string; checked: boolean; title: string; start: string; end: string; lunar: boolean; substitute: boolean };

/**
 * "เพิ่มวันหยุดราชการ": the year's fixed-date Thai public holidays (+ suggested
 * substitute days) pre-filled, Buddhist lunar holidays with an empty date to
 * fill in from the official announcement. Tick, adjust, choose the schools,
 * add them all as holidays in one go (re-adding updates instead of duplicating).
 */
export default function HolidayPresetPanel({
  defaultYear,
  sites,
  importEvents,
  onDone,
}: {
  defaultYear: number;
  sites: { id: string; name: string }[];
  importEvents: (rows: BulkEventRow[]) => Promise<{ ok: boolean; message: string; results: BulkEventResult[] }>;
  onDone: () => void;
}) {
  const { dict, locale } = useLanguage();
  const x = dict.calendarTools;
  const names = x.holidayNames as Record<string, string>;
  const [year, setYear] = useState(defaultYear);
  const build = (y: number): Item[] =>
    thaiHolidayPresets(y).map((h, i) => ({
      id: `${h.key}-${i}`,
      checked: !h.optional,
      title: h.substituteFor ? x.substituteFor(names[h.substituteFor] ?? h.substituteFor) : names[h.key] ?? h.key,
      start: h.start,
      end: h.end,
      lunar: !!h.lunar,
      substitute: !!h.substituteFor,
    }));
  const [items, setItems] = useState<Item[]>(() => build(defaultYear));
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string; results: BulkEventResult[] } | null>(null);

  const set = (id: string, patch: Partial<Item>) => setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const chosen = useMemo(() => items.filter((i) => i.checked), [items]);
  const missingDate = chosen.filter((i) => !i.start);

  function changeYear(y: number) {
    setYear(y);
    setItems(build(y));
    setResult(null);
  }

  function onAdd() {
    if (missingDate.length) return setResult({ ok: false, message: x.fillLunar(missingDate.map((i) => i.title).join(", ")), results: [] });
    if (!confirm(x.addConfirm(chosen.length))) return;
    const schools = siteIds.map((id) => sites.find((s) => s.id === id)?.name ?? "").filter(Boolean).join(", ");
    const rows: BulkEventRow[] = chosen.map((i, n) => ({ row: n + 1, title: i.title, start: i.start, end: i.end || i.start, holiday: true, schools, detail: "" }));
    startTransition(async () => {
      const res = await importEvents(rows);
      setResult(res);
      if (res.ok) onDone();
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">{x.holidaysTitle}</h2>
        <label className="flex items-center gap-2 text-xs text-muted">
          {x.year}
          <select value={year} onChange={(e) => changeYear(Number(e.target.value))} className="input py-1">
            {[defaultYear - 1, defaultYear, defaultYear + 1, defaultYear + 2].map((y) => (
              <option key={y} value={y}>{locale === "th" ? `${y + 543} (${y})` : y}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-1 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">{x.holidaysWarning}</p>

      <div className="mt-3 flex flex-col">
        {items.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-2 border-t border-line-soft py-1.5 first:border-t-0">
            <input type="checkbox" checked={i.checked} onChange={(e) => set(i.id, { checked: e.target.checked })} className="h-4 w-4 accent-brand" aria-label={i.title} />
            <input value={i.title} onChange={(e) => set(i.id, { title: e.target.value })} className="input min-w-0 flex-1 py-1 text-sm" />
            <input type="date" value={i.start} onChange={(e) => set(i.id, { start: e.target.value, end: !i.end || i.end < e.target.value ? e.target.value : i.end })} className={`input py-1 ${i.checked && !i.start ? "border-danger" : ""}`} />
            <span className="text-xs text-faint">–</span>
            <input type="date" value={i.end} min={i.start} onChange={(e) => set(i.id, { end: e.target.value })} className="input py-1" />
            {i.lunar && <span className="badge bg-warn-soft text-warn">{x.lunarTag}</span>}
            {i.substitute && <span className="badge bg-info-soft text-info">{x.substituteTag}</span>}
          </div>
        ))}
      </div>

      <div className="mt-3">
        <SitePicker sites={sites} value={siteIds} onChange={setSiteIds} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending || chosen.length === 0} onClick={onAdd} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? dict.common.saving : x.addButton(chosen.length)}
        </button>
        {missingDate.length > 0 && <span className="text-xs text-danger">{x.missingDates(missingDate.length)}</span>}
      </div>
      {result && <ResultBox result={result} />}
    </div>
  );
}
