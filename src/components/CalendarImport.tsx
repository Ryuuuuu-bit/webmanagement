"use client";

import { useRef, useState, useTransition } from "react";
import { useLanguage } from "./LanguageProvider";
import { parseDateCell } from "@/lib/parseDateCell";
import { readWorkbook } from "@/lib/readSheet";
import type { BulkEventResult, BulkEventRow } from "@/actions/calendar";

type Field = "title" | "start" | "end" | "holiday" | "schools" | "detail";
const FIELDS: Field[] = ["title", "start", "end", "holiday", "schools", "detail"];

// Header spellings recognised automatically (lower-case); others are mapped by hand.
const GUESS: Record<Field, string[]> = {
  title: ["title", "name", "event", "activity", "ชื่อกิจกรรม", "กิจกรรม", "ชื่อ", "รายการ", "วันสำคัญ"],
  start: ["start", "start date", "from", "date", "วันเริ่ม", "วันที่เริ่ม", "เริ่ม", "วันที่", "ตั้งแต่"],
  end: ["end", "end date", "to", "until", "วันจบ", "วันสิ้นสุด", "สิ้นสุด", "ถึง", "ถึงวันที่"],
  holiday: ["holiday", "is holiday", "day off", "วันหยุด", "หยุด", "หยุดเรียน"],
  schools: ["school", "schools", "site", "sites", "โรงเรียน", "สาขา", "site"],
  detail: ["detail", "details", "note", "notes", "description", "รายละเอียด", "หมายเหตุ"],
};

const YES = new Set(["ใช่", "y", "yes", "true", "1", "x", "✓", "✔", "หยุด", "วันหยุด", "holiday", "ปิด", "หยุดเรียน", "t"]);

type Sheet = { headers: string[]; rows: Record<string, unknown>[] };

/**
 * "นำเข้าแผนทั้งปี": .xlsx / .xls / .csv (also a Google Sheet downloaded as
 * either) with any headers — the Admin maps columns, sees a preview with
 * unreadable dates in red, then imports. Without a "holiday" or "schools"
 * column, one value applies to every row.
 */
export default function CalendarImport({
  sites,
  importEvents,
  onDone,
}: {
  sites: { id: string; name: string }[];
  importEvents: (rows: BulkEventRow[]) => Promise<{ ok: boolean; message: string; results: BulkEventResult[] }>;
  onDone: () => void;
}) {
  const { dict } = useLanguage();
  const x = dict.calendarTools;
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [map, setMap] = useState<Record<Field, string>>({ title: "", start: "", end: "", holiday: "", schools: "", detail: "" });
  const [allHoliday, setAllHoliday] = useState(true);
  const [allSchool, setAllSchool] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string; results: BulkEventResult[] } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setResult(null);
    setSheet(null);
    setParseError(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setParseError(x.parseError);
    try {
      const XLSX = await import("xlsx");
      const wb = await readWorkbook(file);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
      const headers = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0] ?? []).map((h) => String(h ?? "").trim()).filter(Boolean);
      if (rows.length === 0 || headers.length === 0) return setParseError(x.empty);
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
      const guessed = {} as Record<Field, string>;
      for (const f of FIELDS) guessed[f] = headers.find((h) => GUESS[f].includes(norm(h)) && !Object.values(guessed).includes(h)) ?? "";
      setMap(guessed);
      setSheet({ headers, rows });
    } catch {
      setParseError(x.parseError);
    }
  }

  const siteName = sites.find((s) => s.id === allSchool)?.name ?? "";
  function mapped(): BulkEventRow[] {
    if (!sheet) return [];
    const cell = (r: Record<string, unknown>, f: Field) => (map[f] ? r[map[f]] : "");
    return sheet.rows
      .map((r, i) => {
        const start = parseDateCell(cell(r, "start"));
        const endRaw = parseDateCell(cell(r, "end"));
        const h = String(cell(r, "holiday") ?? "").trim().toLowerCase();
        return {
          row: i + 2,
          title: String(cell(r, "title") ?? "").trim(),
          start,
          end: endRaw || start,
          holiday: map.holiday ? YES.has(h) : allHoliday,
          schools: map.schools ? String(cell(r, "schools") ?? "").trim() : siteName,
          detail: String(cell(r, "detail") ?? "").trim(),
        };
      })
      .filter((r) => r.title || r.start);
  }

  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const f = x.fields;
    const ws = XLSX.utils.aoa_to_sheet([
      [f.title, f.start, f.end, f.holiday, f.schools, f.detail],
      [x.sampleTitle1, "16/05/2570", "16/05/2570", x.yes, "", x.sampleDetail1],
      [x.sampleTitle2, "2027-10-11", "2027-10-29", x.yes, sites.slice(0, 2).map((s) => s.name).join(", "), ""],
      [x.sampleTitle3, "05/09/2570", "", x.no, sites[0]?.name ?? "", ""],
    ]);
    ws["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 30 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "calendar");
    XLSX.writeFile(wb, "school-calendar-template.xlsx");
  }

  const preview = sheet ? mapped() : [];
  const bad = (d: string) => !!d && !/^\d{4}-\d{2}-\d{2}$/.test(d);

  function onImport() {
    if (!map.title || !map.start) return setParseError(x.needTitleStart);
    if (!confirm(x.importConfirm(preview.length))) return;
    startTransition(async () => {
      const res = await importEvents(preview);
      setResult(res);
      if (res.ok) {
        setSheet(null);
        if (fileRef.current) fileRef.current.value = "";
        onDone();
      }
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{x.importTitle}</h2>
      <p className="mt-1 text-sm text-muted">{x.importHint}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-ink" />
        <button type="button" onClick={downloadTemplate} className="text-xs font-medium text-brand-ink hover:underline">{x.template}</button>
      </div>
      <p className="mt-1 text-[11px] text-faint">{x.formats}</p>
      {parseError && <p className="mt-2 text-sm text-danger">{parseError}</p>}

      {sheet && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {FIELDS.map((f) => (
              <label key={f} className="flex flex-col gap-1 text-xs text-muted">
                {x.fields[f]}{f === "title" || f === "start" ? " *" : ""}
                <select value={map[f]} onChange={(e) => setMap({ ...map, [f]: e.target.value })} className="input py-1.5">
                  <option value="">{f === "holiday" || f === "schools" ? x.sameForAll : f === "end" ? x.sameAsStart : x.notInFile}</option>
                  {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          {(!map.holiday || !map.schools) && (
            <div className="flex flex-wrap items-center gap-4 rounded-lg bg-page p-3 text-xs">
              {!map.holiday && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={allHoliday} onChange={(e) => setAllHoliday(e.target.checked)} className="h-4 w-4 accent-brand" />
                  {x.allRowsHoliday}
                </label>
              )}
              {!map.schools && (
                <label className="flex items-center gap-2">
                  {x.allRowsSchool}
                  <select value={allSchool} onChange={(e) => setAllSchool(e.target.value)} className="input py-1">
                    <option value="">{dict.schoolCalendar.allSchools}</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          <p className="text-[11px] text-faint">{x.matchHint}</p>

          <div className="overflow-x-auto rounded-lg border border-line-soft">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left uppercase text-faint">
                  <th className="px-2 py-1.5">#</th>
                  {FIELDS.map((f) => <th key={f} className="px-2 py-1.5">{x.fields[f]}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 30).map((r) => (
                  <tr key={r.row} className="border-t border-line-soft">
                    <td className="px-2 py-1">{r.row}</td>
                    <td className="px-2 py-1">{r.title}</td>
                    <td className={`px-2 py-1 ${bad(r.start) || !r.start ? "text-danger" : ""}`}>{r.start || "—"}</td>
                    <td className={`px-2 py-1 ${bad(r.end) ? "text-danger" : ""}`}>{r.end}</td>
                    <td className="px-2 py-1">{r.holiday ? x.yes : x.no}</td>
                    <td className="px-2 py-1">{r.schools || dict.schoolCalendar.allSchools}</td>
                    <td className="px-2 py-1">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 30 && <p className="text-[11px] text-faint">{x.previewMore(preview.length - 30)}</p>}
          <button type="button" disabled={pending || preview.length === 0} onClick={onImport} className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? dict.common.saving : x.importButton(preview.length)}
          </button>
        </div>
      )}

      {result && <ResultBox result={result} />}
    </div>
  );
}

export function ResultBox({ result }: { result: { ok: boolean; message: string; results: BulkEventResult[] } }) {
  const { dict } = useLanguage();
  const failed = result.results.filter((r) => !r.ok);
  return (
    <div className={`mt-3 rounded-lg p-4 text-sm ${result.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
      <p className="font-medium">{result.message}</p>
      {failed.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs">
          {failed.slice(0, 50).map((r) => (
            <li key={r.row}>{dict.calendarTools.rowError(r.row, r.title, r.message)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
