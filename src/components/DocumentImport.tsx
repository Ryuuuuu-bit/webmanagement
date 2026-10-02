"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import { parseDateCell } from "@/lib/parseDateCell";
import type { ImportDocumentResult, ImportDocumentRow } from "@/actions/documents";

type Field = "teacher" | "type" | "number" | "issueDate" | "expiryDate" | "note";
const FIELDS: Field[] = ["teacher", "type", "number", "issueDate", "expiryDate", "note"];

// Header spellings recognised automatically (lower-case, spaces collapsed);
// anything else the Admin maps by hand in the column pickers.
const GUESS: Record<Field, string[]> = {
  teacher: ["teacher", "name", "ชื่อ", "ชื่อครู", "ชื่อ-นามสกุล", "ชื่อ-สกุล", "ครู", "username", "email", "อีเมล", "full name", "employee"],
  type: ["type", "document", "document type", "ประเภท", "ประเภทเอกสาร", "เอกสาร"],
  number: ["number", "no", "no.", "เลขที่", "เลขที่เอกสาร", "permit no", "work permit no", "passport no", "เลขที่ใบอนุญาต"],
  issueDate: ["issue date", "issued", "date of issue", "วันออก", "วันที่ออก", "วันออกเอกสาร", "start date", "วันเริ่ม"],
  expiryDate: ["expiry", "expiry date", "expire", "expires", "expiration", "expiration date", "date of expiry", "วันหมดอายุ", "หมดอายุ", "วันที่หมดอายุ", "end date"],
  note: ["note", "notes", "remark", "remarks", "หมายเหตุ"],
};

type Sheet = { headers: string[]; rows: Record<string, unknown>[] };

/**
 * "นำเข้าเอกสารจากไฟล์": accepts .xlsx / .xls / .csv — including a Google
 * Sheet downloaded as either — with any column headers: the Admin maps
 * columns to fields (common Thai/English headers are pre-selected). A sheet
 * without a "type" column can apply one document type to every row.
 */
export default function DocumentImport({
  types,
  importDocuments,
}: {
  types: { id: string; name: string }[];
  importDocuments: (rows: ImportDocumentRow[]) => Promise<{ ok: boolean; message: string; results: ImportDocumentResult[] }>;
}) {
  const { dict } = useLanguage();
  const t = dict.documents;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [map, setMap] = useState<Record<Field, string>>({ teacher: "", type: "", number: "", issueDate: "", expiryDate: "", note: "" });
  const [fixedType, setFixedType] = useState(types[0]?.name ?? "Work Permit");
  const [parseError, setParseError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string; results: ImportDocumentResult[] } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setResult(null);
    setSheet(null);
    setParseError(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setParseError(t.importParseError);
    try {
      const XLSX = await import("xlsx");
      // No cellDates: SheetJS builds those Dates in the browser's timezone with
      // historic offsets (Bangkok LMT) that can land on the previous day — the
      // raw Excel serial is converted in UTC by parseDateCell instead. raw:true
      // keeps CSV text as typed, so "14/01/2570" isn't re-read as month-first.
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
      const headers = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0] ?? []).map((h) => String(h ?? "").trim()).filter(Boolean);
      if (rows.length === 0 || headers.length === 0) return setParseError(t.importEmpty);
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
      const guessed = {} as Record<Field, string>;
      for (const f of FIELDS) guessed[f] = headers.find((h) => GUESS[f].includes(norm(h))) ?? "";
      setMap(guessed);
      setSheet({ headers, rows });
    } catch {
      setParseError(t.importParseError);
    }
  }

  function mapped(): ImportDocumentRow[] {
    if (!sheet) return [];
    const cell = (r: Record<string, unknown>, f: Field) => (map[f] ? r[map[f]] : "");
    return sheet.rows
      .map((r, i) => ({
        row: i + 2,
        teacher: String(cell(r, "teacher") ?? "").trim(),
        type: map.type ? String(cell(r, "type") ?? "").trim() || fixedType : fixedType,
        number: String(cell(r, "number") ?? "").trim(),
        issueDate: parseDateCell(cell(r, "issueDate")),
        expiryDate: parseDateCell(cell(r, "expiryDate")),
        note: String(cell(r, "note") ?? "").trim(),
      }))
      .filter((r) => r.teacher);
  }

  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      ["teacher", "type", "number", "issue date", "expiry date", "note"],
      ["somchai.j", "Work Permit", "WP-123456", "2025-01-15", "2027-01-14", ""],
      ["John Smith", "Visa", "", "15/01/2569", "14/01/2570", "Non-B"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "documents");
    XLSX.writeFile(wb, "teacher-documents-template.xlsx");
  }

  const preview = sheet ? mapped() : [];

  function onImport() {
    if (!map.teacher) return setParseError(t.importNeedTeacher);
    if (!confirm(t.importConfirm(preview.length))) return;
    startTransition(async () => {
      const res = await importDocuments(preview);
      setResult(res);
      if (res.ok) {
        setSheet(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">{t.importTitle}</h2>
          <p className="mt-1 text-sm text-muted">{t.importHint}</p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand-ink hover:bg-line-soft">
          {open ? dict.common.close : t.importOpen}
        </button>
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-ink" />
            <button type="button" onClick={downloadTemplate} className="text-xs font-medium text-brand-ink hover:underline">{t.importTemplate}</button>
          </div>
          <p className="text-[11px] text-faint">{t.importFormats}</p>
          {parseError && <p className="text-sm text-danger">{parseError}</p>}

          {sheet && (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                {FIELDS.map((f) => (
                  <label key={f} className="flex flex-col gap-1 text-xs text-muted">
                    {t.fields[f]}{f === "teacher" ? " *" : ""}
                    <select value={map[f]} onChange={(e) => setMap({ ...map, [f]: e.target.value })} className="input py-1.5">
                      <option value="">{f === "type" ? t.sameTypeAll : t.notInFile}</option>
                      {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
                {!map.type && (
                  <label className="flex flex-col gap-1 text-xs text-muted">
                    {t.typeForAll}
                    <input list="doc-type-options" value={fixedType} onChange={(e) => setFixedType(e.target.value)} className="input py-1.5" />
                    <datalist id="doc-type-options">
                      {types.map((x) => <option key={x.id} value={x.name} />)}
                    </datalist>
                  </label>
                )}
              </div>
              <p className="text-[11px] text-faint">{t.importMatchHint}</p>

              <div className="overflow-x-auto rounded-lg border border-line-soft">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left uppercase text-faint">
                      <th className="px-2 py-1.5">#</th>
                      {FIELDS.map((f) => <th key={f} className="px-2 py-1.5">{t.fields[f]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 20).map((r) => (
                      <tr key={r.row} className="border-t border-line-soft">
                        <td className="px-2 py-1">{r.row}</td>
                        <td className="px-2 py-1">{r.teacher}</td>
                        <td className="px-2 py-1">{r.type}</td>
                        <td className="px-2 py-1 font-mono">{r.number}</td>
                        {[r.issueDate, r.expiryDate].map((d, i) => (
                          <td key={i} className={`px-2 py-1 ${d && !/^\d{4}-\d{2}-\d{2}$/.test(d) ? "text-danger" : ""}`}>{d}</td>
                        ))}
                        <td className="px-2 py-1">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.length > 20 && <p className="text-[11px] text-faint">{t.importPreviewMore(preview.length - 20)}</p>}
              <button type="button" disabled={pending || preview.length === 0} onClick={onImport} className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {pending ? dict.common.saving : t.importButton(preview.length)}
              </button>
            </>
          )}

          {result && (
            <div className={`rounded-lg p-4 text-sm ${result.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
              <p className="font-medium">{result.message}</p>
              {result.results.some((r) => !r.ok) && (
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {result.results.filter((r) => !r.ok).slice(0, 50).map((r) => (
                    <li key={r.row}>{t.importRowError(r.row, r.teacher, r.message)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
