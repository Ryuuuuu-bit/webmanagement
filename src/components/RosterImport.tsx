"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import { isDateKey, parseDateCell } from "@/lib/parseDateCell";
import { readWorkbook } from "@/lib/readSheet";
import { bangkokDateKey, daysBetweenKeys } from "@/lib/date";
import { cleanPersonName, normHeader, parseGradeLevels, ROSTER_FIELDS, ROSTER_GUESS, type RosterField } from "@/lib/roster";
import type { RosterDoc, RosterDocKind, RosterOptions, RosterResult, RosterRow } from "@/actions/roster";

type Sheet = { headers: string[]; rows: { row: number; cells: Record<string, unknown> }[]; skipped: number };
type Existing = { email: string; username: string | null; name: string };

const KINDS: RosterDocKind[] = ["passport", "workPermit", "license"];
const KIND_FIELDS: Record<RosterDocKind, { no: RosterField; issue: RosterField; exp: RosterField }> = {
  passport: { no: "ppNo", issue: "ppIssue", exp: "ppExp" },
  workPermit: { no: "wpNo", issue: "wpIssue", exp: "wpExp" },
  license: { no: "tlNo", issue: "tlIssue", exp: "tlExp" },
};
const TYPE_MATCH: Record<RosterDocKind, RegExp> = {
  passport: /passport|พาสปอร์ต|หนังสือเดินทาง/i,
  workPermit: /work\s*permit|ใบอนุญาตทำงาน/i,
  license: /licen[cs]e|วิชาชีพ/i,
};
const TYPE_FALLBACK: Record<RosterDocKind, string> = {
  passport: "Passport",
  workPermit: "Work Permit",
  license: "Teaching License (ใบอนุญาตประกอบวิชาชีพครู)",
};
const FIELD_GROUPS: { key: "profile" | RosterDocKind; fields: RosterField[] }[] = [
  { key: "profile", fields: ["name", "email", "username", "thaiName", "nickname", "nationality", "phone", "startDate", "classLevels", "subjects", "project"] },
  { key: "passport", fields: ["ppNo", "ppIssue", "ppExp"] },
  { key: "workPermit", fields: ["wpNo", "wpIssue", "wpExp"] },
  { key: "license", fields: ["tlNo", "tlIssue", "tlExp"] },
];
const ALIAS = new Set(Object.values(ROSTER_GUESS).flat());

/**
 * "นำเข้าทะเบียนครู": one row per teacher with the documents side by side
 * (the client's TeacherData.xlsx). Columns are recognised by header — both
 * its short ("WPExp") and long ("Work Permit Exp") header rows — and a
 * second header row is skipped. Teachers without an account can be created
 * on the spot; the result lists their temporary passwords once.
 */
export default function RosterImport({
  types,
  sites,
  existing,
  importRoster,
}: {
  types: { id: string; name: string }[];
  sites: { id: string; name: string }[];
  existing: Existing[];
  importRoster: (rows: RosterRow[], options: RosterOptions) => Promise<{ ok: boolean; message: string; results: RosterResult[] }>;
}) {
  const { dict } = useLanguage();
  const t = dict.roster;
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [map, setMap] = useState<Record<RosterField, string>>(() => Object.fromEntries(ROSTER_FIELDS.map((f) => [f, ""])) as Record<RosterField, string>);
  const [typeNames, setTypeNames] = useState<Record<RosterDocKind, string>>(() => {
    const pick = (k: RosterDocKind) => types.find((x) => TYPE_MATCH[k].test(x.name))?.name ?? TYPE_FALLBACK[k];
    return { passport: pick("passport"), workPermit: pick("workPermit"), license: pick("license") };
  });
  const [createMissing, setCreateMissing] = useState(true);
  const [siteId, setSiteId] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string; results: RosterResult[] } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setResult(null);
    setSheet(null);
    setParseError(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setParseError(dict.documents.importParseError);
    try {
      const XLSX = await import("xlsx");
      const wb = await readWorkbook(file);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
      if (grid.length < 2) return setParseError(dict.documents.importEmpty);
      // Header row = the first row with ≥2 recognised headers (some sheets have a title row on top).
      const isHeaderRow = (r: unknown[]) => r.filter((c) => ALIAS.has(normHeader(String(c ?? "")))).length >= 2;
      const hIdx = Math.max(0, grid.slice(0, 5).findIndex(isHeaderRow));
      const raw = (grid[hIdx] ?? []).map((h, i) => String(h ?? "").trim() || `#${i + 1}`);
      // Make duplicate header names unique so every column stays addressable.
      const seen = new Map<string, number>();
      const headers = raw.map((h) => {
        const n = (seen.get(h) ?? 0) + 1;
        seen.set(h, n);
        return n > 1 ? `${h} (${n})` : h;
      });
      const guessed = Object.fromEntries(ROSTER_FIELDS.map((f) => [f, ""])) as Record<RosterField, string>;
      const claim = (f: RosterField, col: number) => {
        if (!guessed[f] && !Object.values(guessed).includes(headers[col])) guessed[f] = headers[col];
      };
      headers.forEach((h, i) => ROSTER_FIELDS.forEach((f) => ROSTER_GUESS[f].includes(normHeader(raw[i])) && claim(f, i)));
      // A second header row (long English names under short codes) fills in what the first missed, then is skipped.
      const rows: Sheet["rows"] = [];
      let skipped = 0;
      for (let r = hIdx + 1; r < grid.length; r++) {
        const line = grid[r] ?? [];
        if (isHeaderRow(line)) {
          line.forEach((c, i) => ROSTER_FIELDS.forEach((f) => ROSTER_GUESS[f].includes(normHeader(String(c ?? ""))) && claim(f, i)));
          skipped++;
          continue;
        }
        if (line.every((c) => String(c ?? "").trim() === "")) continue;
        rows.push({ row: r + 1, cells: Object.fromEntries(headers.map((h, i) => [h, line[i]])) });
      }
      if (rows.length === 0) return setParseError(dict.documents.importEmpty);
      setMap(guessed);
      setSheet({ headers, rows, skipped });
    } catch {
      setParseError(dict.documents.importParseError);
    }
  }

  const today = bangkokDateKey();
  const known = useMemo(() => {
    const byEmail = new Set(existing.map((u) => u.email.toLowerCase()));
    const byUser = new Set(existing.map((u) => (u.username ?? "").toLowerCase()).filter(Boolean));
    const byName = new Set(existing.map((u) => normHeader(u.name)));
    // Same rule as the server: a row with an email matches by email only.
    return (r: RosterRow) =>
      r.email ? byEmail.has(r.email.toLowerCase()) : (!!r.username && byUser.has(r.username.toLowerCase())) || byName.has(normHeader(r.name));
  }, [existing]);

  const preview: RosterRow[] = useMemo(() => {
    if (!sheet) return [];
    const text = (cells: Record<string, unknown>, f: RosterField) => {
      const v = map[f] ? cells[map[f]] : "";
      return String(v ?? "").trim().replace(/\s+/g, " ");
    };
    const date = (cells: Record<string, unknown>, f: RosterField) => (map[f] ? parseDateCell(cells[map[f]]) : "");
    return sheet.rows
      .map(({ row, cells }) => {
        let phone = text(cells, "phone");
        if (/^[1-9]\d{8}$/.test(phone)) phone = "0" + phone; // a number cell lost the leading 0
        const docs: RosterDoc[] = KINDS.map((kind) => {
          const k = KIND_FIELDS[kind];
          // "Ppissue" may be a date or the issuing office ("DFA Manila") — the latter goes to the note.
          const issueRaw = map[k.issue] ? cells[map[k.issue]] : "";
          const issue = parseDateCell(issueRaw);
          const issueOk = !!issue && isDateKey(issue);
          const issueText = String(issueRaw ?? "").trim();
          // Something shaped like a date is a date — a bad one is reported, not filed as an office.
          const looksLikeDate = typeof issueRaw === "number" || /\d{1,4}\s*[\/.\-]\s*\d{1,2}\s*[\/.\-]\s*\d{2,4}/.test(issueText);
          return {
            kind,
            number: text(cells, k.no),
            issueDate: issueOk ? issue : looksLikeDate ? issueText : "",
            expiryDate: date(cells, k.exp),
            note: !issueOk && !looksLikeDate && issueText ? t.issuedAt(issueText) : "",
          };
        });
        return {
          row,
          name: cleanPersonName(text(cells, "name")),
          email: text(cells, "email").toLowerCase(),
          username: text(cells, "username"),
          thaiName: text(cells, "thaiName"),
          nickname: text(cells, "nickname"),
          nationality: text(cells, "nationality"),
          phone,
          startDate: date(cells, "startDate"),
          classLevels: text(cells, "classLevels"),
          subjects: text(cells, "subjects"),
          project: text(cells, "project"),
          docs,
        };
      })
      .filter((r) => r.name || r.email);
  }, [sheet, map, t]);

  const dupEmails = useMemo(() => {
    const c = new Map<string, number>();
    preview.forEach((r) => r.email && c.set(r.email, (c.get(r.email) ?? 0) + 1));
    return new Set(Array.from(c).filter(([, n]) => n > 1).map(([e]) => e));
  }, [preview]);

  const expiryInfo = (d: string) => {
    if (!d) return null;
    if (!isDateKey(d)) return { tone: "text-danger", label: d, state: "bad" as const };
    const left = daysBetweenKeys(today, d);
    return {
      tone: left < 0 ? "font-semibold text-danger" : left <= 90 ? "font-semibold text-warn" : "",
      label: d,
      state: left < 0 ? ("expired" as const) : left <= 90 ? ("soon" as const) : ("ok" as const),
    };
  };

  const stats = useMemo(() => {
    let isNew = 0, expired = 0, soon = 0, noWp = 0;
    for (const r of preview) {
      if (!known(r)) isNew++;
      for (const d of r.docs) {
        const e = expiryInfo(d.expiryDate);
        if (e?.state === "expired") expired++;
        else if (e?.state === "soon") soon++;
      }
      if (!r.docs.find((d) => d.kind === "workPermit")?.number) noWp++;
    }
    return { total: preview.length, isNew, existing: preview.length - isNew, expired, soon, noWp };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, known, today]);

  function onImport() {
    if (!map.name && !map.email) return setParseError(t.needNameOrEmail);
    if (!confirm(t.confirm(preview.length, createMissing ? stats.isNew : 0))) return;
    startTransition(async () => {
      const res = await importRoster(preview, { createMissing, siteId: siteId || null, typeNames });
      setResult(res);
      if (res.ok) {
        setSheet(null);
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    });
  }

  function downloadResults() {
    if (!result) return;
    const safe = (v: unknown) => {
      const str = String(v ?? "");
      return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str; // spreadsheet formula injection
    };
    const lines = [["row", "name", "email", "username", "tempPassword", "account", "documents", "message"].join(",")];
    for (const r of result.results) {
      lines.push([r.row, r.name, r.email, r.username ?? "", r.tempPassword ?? "", r.account, r.docs, r.message].map((v) => `"${safe(v).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "teachschedule-roster-import-results.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const groupLabel = (k: "profile" | RosterDocKind) => (k === "profile" ? t.groupProfile : typeNames[k] || TYPE_FALLBACK[k]);
  const accountBadge = (a: RosterResult["account"]) =>
    a === "created" ? "bg-ok-soft text-ok" : a === "matched" ? "bg-info-soft text-info" : a === "skipped" ? "bg-line-soft text-muted" : "bg-danger-soft text-danger";

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">{t.title}</h2>
          <p className="mt-1 text-sm text-muted">{t.hint}</p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand-ink hover:bg-line-soft">
          {open ? dict.common.close : t.open}
        </button>
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-ink" />
            <p className="text-[11px] text-faint">{t.formats}</p>
            <p className="text-[11px] text-faint">{t.privacy}</p>
          </div>
          {parseError && <p className="text-sm text-danger">{parseError}</p>}

          {sheet && (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="badge bg-line-soft text-ink">{t.statTotal(stats.total)}</span>
                <span className="badge bg-ok-soft text-ok">{t.statNew(stats.isNew)}</span>
                <span className="badge bg-info-soft text-info">{t.statExisting(stats.existing)}</span>
                {stats.expired > 0 && <span className="badge bg-danger-soft text-danger">{t.statExpired(stats.expired)}</span>}
                {stats.soon > 0 && <span className="badge bg-warn-soft text-warn">{t.statSoon(stats.soon)}</span>}
                {stats.noWp > 0 && <span className="badge bg-line-soft text-muted">{t.statNoWp(stats.noWp)}</span>}
                {sheet.skipped > 0 && <span className="badge bg-line-soft text-muted">{t.statHeaderSkipped(sheet.skipped)}</span>}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {KINDS.map((k) => (
                  <label key={k} className="flex flex-col gap-1 text-xs text-muted">
                    {t.typeFor[k]}
                    <input list="roster-type-options" value={typeNames[k]} onChange={(e) => setTypeNames({ ...typeNames, [k]: e.target.value })} className="input py-1.5" />
                  </label>
                ))}
                <datalist id="roster-type-options">
                  {types.map((x) => <option key={x.id} value={x.name} />)}
                </datalist>
              </div>

              <div className="flex flex-col gap-2 rounded-lg border border-line-soft p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
                  {t.createMissing}
                </label>
                {createMissing && (
                  <label className="flex flex-col gap-1 text-xs text-muted sm:max-w-xs">
                    {t.siteForNew}
                    <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="input py-1.5">
                      <option value="">{t.siteNone}</option>
                      {sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </label>
                )}
              </div>

              <details className="rounded-lg border border-line-soft p-3">
                <summary className="cursor-pointer text-xs font-semibold text-brand-ink">{t.mapping(ROSTER_FIELDS.filter((f) => map[f]).length, ROSTER_FIELDS.length)}</summary>
                <div className="mt-3 flex flex-col gap-3">
                  {FIELD_GROUPS.map((g) => (
                    <div key={g.key}>
                      <p className="mb-1 text-[11px] font-semibold uppercase text-faint">{groupLabel(g.key)}</p>
                      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {g.fields.map((f) => (
                          <label key={f} className="flex flex-col gap-1 text-xs text-muted">
                            {t.fields[f]}
                            <select value={map[f]} onChange={(e) => setMap({ ...map, [f]: e.target.value })} className="input py-1.5">
                              <option value="">{dict.documents.notInFile}</option>
                              {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>

              <div className="overflow-x-auto rounded-lg border border-line-soft">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left uppercase text-faint">
                      <th className="px-2 py-1.5">#</th>
                      <th className="px-2 py-1.5">{t.colTeacher}</th>
                      <th className="px-2 py-1.5">{t.colAccount}</th>
                      <th className="px-2 py-1.5">{t.fields.project}</th>
                      <th className="px-2 py-1.5">{t.colLevels}</th>
                      {KINDS.map((k) => <th key={k} className="px-2 py-1.5">{t.colExpiry[k]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => {
                      const isKnown = known(r);
                      const levels = parseGradeLevels(r.classLevels);
                      return (
                        <tr key={r.row} className="border-t border-line-soft align-top">
                          <td className="px-2 py-1 text-faint">{r.row}</td>
                          <td className="px-2 py-1">
                            <div className="font-medium">{r.name || "—"}{r.nickname && <span className="ml-1 text-faint">({r.nickname})</span>}</div>
                            <div className="text-faint">{r.email || "—"}</div>
                            {dupEmails.has(r.email) && <span className="badge mt-0.5 bg-warn-soft text-warn">{t.dupInFile}</span>}
                          </td>
                          <td className="px-2 py-1">
                            <span className={`badge ${isKnown ? "bg-info-soft text-info" : createMissing ? "bg-ok-soft text-ok" : "bg-line-soft text-muted"}`}>
                              {isKnown ? t.accExisting : createMissing ? t.accNew : t.accSkip}
                            </span>
                          </td>
                          <td className="px-2 py-1">{r.project || "—"}</td>
                          <td className="px-2 py-1" title={r.classLevels}>{levels.length ? levels.map((l) => dict.grades[l]).join(", ") : <span className="text-faint">—</span>}</td>
                          {r.docs.map((d) => {
                            const e = expiryInfo(d.expiryDate);
                            return (
                              <td key={d.kind} className="px-2 py-1">
                                <div className={e?.tone ?? "text-faint"}>{e ? e.label : "—"}</div>
                                {d.number ? <div className="font-mono text-[10px] text-faint">{d.number}</div> : d.kind === "workPermit" && <div className="text-[10px] text-faint">{t.noNumber}</div>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-faint">{t.legend}</p>

              <button type="button" disabled={pending || preview.length === 0} onClick={onImport} className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {pending ? dict.common.saving : t.button(preview.length)}
              </button>
            </>
          )}

          {result && (
            <div className={`rounded-lg p-4 text-sm ${result.ok ? "bg-ok-soft" : "bg-danger-soft"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={`font-medium ${result.ok ? "text-ok" : "text-danger"}`}>{result.message}</p>
                {result.results.length > 0 && (
                  <button type="button" onClick={downloadResults} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-brand-ink">
                    {t.downloadResults}
                  </button>
                )}
              </div>
              {result.results.some((r) => r.tempPassword) && <p className="mt-1 text-xs text-warn">{t.passwordsOnce}</p>}
              <div className="mt-3 overflow-x-auto rounded-lg border border-line-soft bg-surface">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left uppercase text-faint">
                      <th className="px-2 py-1.5">#</th>
                      <th className="px-2 py-1.5">{t.colTeacher}</th>
                      <th className="px-2 py-1.5">{dict.users.colUsername}</th>
                      <th className="px-2 py-1.5">{t.colTempPassword}</th>
                      <th className="px-2 py-1.5">{t.colAccount}</th>
                      <th className="px-2 py-1.5">{t.colDocs}</th>
                      <th className="px-2 py-1.5">{t.colMessage}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((r) => (
                      <tr key={`${r.row}-${r.email}`} className="border-t border-line-soft">
                        <td className="px-2 py-1 text-faint">{r.row}</td>
                        <td className="px-2 py-1">{r.name}</td>
                        <td className="px-2 py-1 font-mono">{r.username ?? "—"}</td>
                        <td className="px-2 py-1 font-mono font-semibold">{r.tempPassword ?? "—"}</td>
                        <td className="px-2 py-1"><span className={`badge ${accountBadge(r.account)}`}>{t.account[r.account]}</span></td>
                        <td className="px-2 py-1">{r.docs}</td>
                        <td className="px-2 py-1 text-muted">{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
