"use client";

import { useRef, useState, useTransition } from "react";
import { useLanguage } from "./LanguageProvider";
import type { ImportUserResult, ImportUserRow } from "@/actions/users";

// Accepted header spellings (Thai or English, any case) → field.
const HEADER_MAP: Record<string, keyof ImportUserRow> = {
  name: "name", "ชื่อ": "name", "ชื่อ-นามสกุล": "name", fullname: "name",
  username: "username", "ชื่อผู้ใช้": "username", user: "username",
  email: "email", "อีเมล": "email",
  department: "department", "ภาควิชา": "department", dept: "department",
  site: "site", "site ประจำ": "site", "จุดเช็คอิน": "site", location: "site",
  role: "role", "บทบาท": "role",
};

/**
 * "นำเข้าจาก Excel": pick an .xlsx/.csv → parsed in the browser with
 * SheetJS (loaded on demand) → preview → importUsers → results with each
 * new account's temporary password (shown once). A template with the
 * expected headers can be downloaded from the same card.
 */
export default function UserImport({ importUsers }: { importUsers: (rows: ImportUserRow[]) => Promise<{ ok: boolean; message: string; results: ImportUserResult[] }> }) {
  const { dict } = useLanguage();
  const t = dict.users;
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImportUserRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string; results: ImportUserResult[] } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setResult(null);
    setRows(null);
    setParseError(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setParseError(t.importParseError);
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const parsed: ImportUserRow[] = raw.map((r) => {
        const out: ImportUserRow = { name: "", username: "", email: "" };
        for (const [k, v] of Object.entries(r)) {
          const field = HEADER_MAP[k.trim().toLowerCase()];
          if (field) out[field] = String(v ?? "").trim();
        }
        return out;
      }).filter((r) => r.name || r.username || r.email);
      if (parsed.length === 0) setParseError(t.importEmpty);
      else setRows(parsed);
    } catch {
      setParseError(t.importParseError);
    }
  }

  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      ["name", "username", "email", "department", "site", "role"],
      ["สมชาย ใจดี", "somchai.j", "somchai@example.com", "", "", "MEMBER"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "users");
    XLSX.writeFile(wb, "teachschedule-users-template.xlsx");
  }

  function onImport() {
    if (!rows) return;
    if (!confirm(t.importConfirm(rows.length))) return;
    startTransition(async () => {
      const res = await importUsers(rows);
      setResult(res);
      if (res.ok) {
        setRows(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  }

  function downloadResults() {
    if (!result) return;
    const lines = [["row", "name", "username", "tempPassword", "status"].join(",")];
    for (const r of result.results) {
      // Neutralise spreadsheet formula injection (a name like =HYPERLINK(...)).
      const safe = (v: unknown) => {
        const str = String(v);
        return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
      };
      lines.push([r.row, r.name, r.username, r.tempPassword ?? "", r.ok ? "OK" : r.message].map((v) => `"${safe(v).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "teachschedule-import-results.csv";
    a.click();
    URL.revokeObjectURL(a.href);
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
            <button type="button" onClick={downloadTemplate} className="text-xs font-medium text-brand-ink hover:underline">
              {t.importTemplate}
            </button>
          </div>
          <p className="text-[11px] text-faint">{t.importColumns}</p>
          {parseError && <p className="text-sm text-danger">{parseError}</p>}

          {rows && (
            <>
              <div className="overflow-x-auto rounded-lg border border-line-soft">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left uppercase text-faint">
                      <th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">name</th><th className="px-2 py-1.5">username</th><th className="px-2 py-1.5">email</th><th className="px-2 py-1.5">department</th><th className="px-2 py-1.5">site</th><th className="px-2 py-1.5">role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t border-line-soft">
                        <td className="px-2 py-1">{i + 2}</td><td className="px-2 py-1">{r.name}</td><td className="px-2 py-1 font-mono">{r.username}</td><td className="px-2 py-1">{r.email}</td><td className="px-2 py-1">{r.department}</td><td className="px-2 py-1">{r.site}</td><td className="px-2 py-1">{r.role || "MEMBER"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 && <p className="text-[11px] text-faint">{t.importPreviewMore(rows.length - 50)}</p>}
              <button type="button" disabled={pending} onClick={onImport} className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {pending ? dict.common.creating : t.importButton(rows.length)}
              </button>
            </>
          )}

          {result && (
            <div className={`rounded-lg p-4 text-sm ${result.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{result.message}</p>
                {result.results.length > 0 && (
                  <button type="button" onClick={downloadResults} className="rounded-lg border border-current px-3 py-1 text-xs font-semibold">
                    {t.importDownloadResults}
                  </button>
                )}
              </div>
              {result.results.length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface text-ink">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left uppercase text-faint">
                        <th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">{t.colName}</th><th className="px-2 py-1.5">{t.colUsername}</th><th className="px-2 py-1.5">{t.importColTemp}</th><th className="px-2 py-1.5">{t.importColStatus}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.results.map((r) => (
                        <tr key={r.row} className="border-t border-line-soft">
                          <td className="px-2 py-1">{r.row}</td>
                          <td className="px-2 py-1">{r.name}</td>
                          <td className="px-2 py-1 font-mono">{r.username}</td>
                          <td className="px-2 py-1 font-mono font-semibold">{r.tempPassword ?? "—"}</td>
                          <td className={`px-2 py-1 ${r.ok ? "text-ok" : "text-danger"}`}>{r.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs opacity-80">{t.importResultHint}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
