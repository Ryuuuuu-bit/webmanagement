"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import TableFilter from "./TableFilter";
import { DOC_STATUS_TONE, type DocStatusValue } from "@/lib/docStatus";
import { encodeFileName, FileReadError, readFileBytes, xhrPost } from "@/lib/uploadClient";

export type DocumentRow = {
  id: string;
  userId: string;
  userName: string;
  siteId: string | null;
  siteName: string | null;
  typeId: string;
  typeName: string;
  number: string | null;
  issueDate: string | null; // YYYY-MM-DD
  expiryDate: string | null; // YYYY-MM-DD
  daysLeft: number | null;
  status: DocStatusValue;
  note: string | null;
  fileName: string | null;
};
type ActionResult = { ok: boolean; message: string };

/**
 * Admin list of every teacher document (work permit, visa, …) with status
 * colours, add/edit form (optional scan upload) and Excel export of what is
 * currently listed.
 */
export default function DocumentsManager({
  rows,
  teachers,
  types,
  sites,
  saveDocument,
  deleteDocument,
  removeDocumentFile,
}: {
  rows: DocumentRow[];
  teachers: { id: string; name: string }[];
  types: { id: string; name: string }[];
  sites: { id: string; name: string }[];
  saveDocument: (id: string | null, fd: FormData) => Promise<ActionResult & { id?: string }>;
  deleteDocument: (id: string) => Promise<ActionResult>;
  removeDocumentFile: (id: string) => Promise<ActionResult>;
}) {
  const { dict, locale } = useLanguage();
  const t = dict.documents;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ row: DocumentRow | null } | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const intl = locale === "en" ? "en-US" : "th-TH";
  const fmt = (key: string | null) => (key ? new Date(`${key}T00:00:00Z`).toLocaleDateString(intl, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
  const left = (r: DocumentRow) => (r.daysLeft === null ? "" : r.daysLeft < 0 ? t.expiredAgo(-r.daysLeft) : t.daysLeft(r.daysLeft));

  async function uploadFile(id: string, file: File): Promise<ActionResult> {
    try {
      const bytes = await readFileBytes(file);
      const res = await xhrPost<ActionResult>(`/api/documents/${id}/file`, bytes, {
        headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeFileName(file.name), "X-File-Type": file.type || "" },
      });
      return res.json ?? { ok: false, message: dict.actions.upload.parseFailed };
    } catch (err) {
      return { ok: false, message: err instanceof FileReadError ? dict.actions.upload.emptyBody : dict.actions.upload.parseFailed };
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    fd.delete("file");
    startTransition(async () => {
      const res = await saveDocument(editing?.row?.id ?? null, fd);
      if (res.ok && res.id && file instanceof File && file.size > 0) {
        const up = await uploadFile(res.id, file);
        if (!up.ok) {
          setResult({ ok: false, message: `${res.message} · ${up.message}` });
          setEditing({ row: null });
          router.refresh();
          return;
        }
      }
      setResult(res);
      if (res.ok) {
        setEditing(null);
        router.refresh();
      }
    });
  }

  function onDelete(r: DocumentRow) {
    if (!confirm(t.deleteConfirm(r.typeName, r.userName))) return;
    startTransition(async () => setResult(await deleteDocument(r.id)));
  }

  function onRemoveFile(r: DocumentRow) {
    if (!confirm(t.removeFileConfirm)) return;
    startTransition(async () => setResult(await removeDocumentFile(r.id)));
  }

  /** Every document (most urgent first) as an .xlsx — filter further in Excel. */
  async function exportExcel() {
    const list = rows;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      [t.colTeacher, t.colSchool, t.colType, t.colNumber, t.colIssue, t.colExpiry, t.colDaysLeft, t.colStatus, t.colNote],
      ...list.map((r) => [r.userName, r.siteName ?? "", r.typeName, r.number ?? "", r.issueDate ?? "", r.expiryDate ?? "", r.daysLeft ?? "", t.status[r.status], r.note ?? ""]),
    ]);
    ws["!cols"] = [{ wch: 26 }, { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "documents");
    XLSX.writeFile(wb, `teacher-documents-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {} as Record<DocStatusValue, number>);
  const row = editing?.row ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["EXPIRED", "EXPIRING", "VALID", "NO_EXPIRY"] as DocStatusValue[]).map((s) => (
          <div key={s} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="text-xs text-muted">{t.status[s]}</div>
            <div className={`mt-1 text-2xl font-bold ${s === "EXPIRED" ? "text-danger" : s === "EXPIRING" ? "text-warn" : s === "VALID" ? "text-ok" : "text-subtle"}`}>{counts[s] ?? 0}</div>
          </div>
        ))}
      </div>

      {result && <p className={`text-sm ${result.ok ? "text-brand-ink" : "text-danger"}`}>{result.message}</p>}

      {editing && (
        <form key={row?.id ?? "new"} onSubmit={onSubmit} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{row ? t.editTitle : t.addTitle}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t.colTeacher}
              <select name="userId" required defaultValue={row?.userId ?? ""} className="input">
                <option value="" disabled>{t.pickTeacher}</option>
                {teachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t.colType}
              <select name="typeId" required defaultValue={row?.typeId ?? types[0]?.id ?? ""} className="input">
                {types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t.colNumber}
              <input name="number" maxLength={100} defaultValue={row?.number ?? ""} className="input" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted">
                {t.colIssue}
                <input name="issueDate" type="date" defaultValue={row?.issueDate ?? ""} className="input" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                {t.colExpiry}
                <input name="expiryDate" type="date" defaultValue={row?.expiryDate ?? ""} className="input" />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
              {t.colNote}
              <input name="note" maxLength={1000} defaultValue={row?.note ?? ""} className="input" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
              {row?.fileName ? t.replaceFile(row.fileName) : t.attachFile}
              <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" className="text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-ink" />
            </label>
          </div>
          <p className="text-[11px] text-faint">{t.renewHint}</p>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? dict.common.saving : dict.common.save}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-line-soft">{dict.common.cancel}</button>
          </div>
        </form>
      )}

      <div id="documents-table" className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">{t.listTitle}</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportExcel} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand-ink hover:bg-line-soft">{t.exportExcel}</button>
            <button type="button" onClick={() => { setResult(null); setEditing({ row: null }); }} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">+ {t.add}</button>
          </div>
        </div>
        <TableFilter
          targetId="documents-table"
          pageSize={50}
          selects={[
            { attr: "status", label: t.colStatus, options: (["EXPIRED", "EXPIRING", "VALID", "NO_EXPIRY"] as DocStatusValue[]).map((s) => ({ value: s, label: t.status[s] })) },
            { attr: "type", label: t.colType, options: types.map((x) => ({ value: x.id, label: x.name })) },
            { attr: "site", label: t.colSchool, options: [...sites.map((x) => ({ value: x.id, label: x.name })), { value: "-", label: "—" }] },
          ]}
        />
        <div className="overflow-x-auto">
          <table className="table-stack w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-faint">
                <th className="pb-2">{t.colTeacher}</th>
                <th className="pb-2">{t.colType}</th>
                <th className="pb-2">{t.colNumber}</th>
                <th className="pb-2">{t.colExpiry}</th>
                <th className="pb-2">{t.colStatus}</th>
                <th className="pb-2">{t.colFile}</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-id={r.id} data-status={r.status} data-type={r.typeId} data-site={r.siteId ?? "-"} className="border-t border-line-soft align-top">
                  <td className="py-2">
                    <div className="font-medium">{r.userName}</div>
                    <div className="text-xs text-faint">{r.siteName ?? "—"}</div>
                  </td>
                  <td className="py-2">{r.typeName}</td>
                  <td className="py-2 font-mono text-xs">{r.number ?? "—"}</td>
                  <td className="py-2">
                    <div>{fmt(r.expiryDate)}</div>
                    <div className="text-xs text-faint">{left(r)}</div>
                  </td>
                  <td className="py-2"><span className={`badge ${DOC_STATUS_TONE[r.status]}`}>{t.status[r.status]}</span></td>
                  <td className="py-2">
                    {r.fileName ? (
                      <span className="flex items-center gap-2">
                        <a href={`/api/documents/${r.id}/file`} target="_blank" rel="noopener" className="text-xs font-medium text-brand-ink underline">{t.viewFile}</a>
                        <button type="button" disabled={pending} onClick={() => onRemoveFile(r)} className="text-xs text-faint hover:text-danger" aria-label={t.removeFile}>✕</button>
                      </span>
                    ) : (
                      <span className="text-xs text-faint">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => { setResult(null); setEditing({ row: r }); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="rounded px-1.5 py-1 text-xs font-semibold text-brand-ink underline hover:bg-line-soft">{dict.common.edit}</button>
                    <button type="button" disabled={pending} onClick={() => onDelete(r)} className="rounded px-1.5 py-1 text-xs font-semibold text-danger hover:bg-line-soft disabled:opacity-40">{dict.common.delete}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-3 text-sm text-faint">{t.empty}</p>}
        </div>
      </div>
    </div>
  );
}
