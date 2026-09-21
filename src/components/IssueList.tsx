"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import TableFilter from "./TableFilter";
import { updateIssue, deleteIssue } from "@/actions/feedback";

export type IssueRow = {
  id: string;
  category: string;
  area: string;
  title: string;
  detail: string;
  pageUrl: string | null;
  device: string | null;
  attachmentName: string | null;
  status: string;
  adminNote: string | null;
  handlerName: string | null;
  reporterName: string;
  createdAt: string;
  dayKey: string;
};

const STATUS_CLS: Record<string, string> = {
  OPEN: "bg-warn-soft text-warn",
  IN_PROGRESS: "bg-info-soft text-info",
  RESOLVED: "bg-ok-soft text-ok",
  CLOSED: "bg-line-soft text-faint",
};
const CAT_CLS: Record<string, string> = {
  BUG: "bg-danger-soft text-danger",
  SUGGESTION: "bg-brand-soft text-brand-ink",
  QUESTION: "bg-info-soft text-info",
  OTHER: "bg-line-soft text-muted",
};
const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

/**
 * Issue reports as cards (a table can't show a paragraph of detail on a
 * phone). Admin gets a status picker + reply box per card; the reporter
 * sees the status and any reply. Filterable by text/status/type/menu/date
 * via TableFilter (cards carry data-* attributes).
 */
export default function IssueList({ id, rows, admin }: { id: string; rows: IssueRow[]; admin: boolean }) {
  const { dict, locale } = useLanguage();
  const t = dict.feedback;
  const opt = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({ value, label }));
  const cats = t.categories as Record<string, string>;
  const areas = t.areas as Record<string, string>;
  const statuses = t.status as Record<string, string>;

  return (
    <div id={id}>
      <TableFilter
        targetId={id}
        selects={[
          { attr: "status", label: t.colStatus, options: opt(statuses) },
          { attr: "category", label: t.colCategory, options: opt(cats) },
          ...(admin ? [{ attr: "area", label: t.colArea, options: opt(areas) }] : []),
        ]}
        dateRange
      />
      <div className="mt-3 flex flex-col gap-3">
        {rows.map((r) => (
          <article
            key={r.id}
            id={`issue-${r.id}`}
            data-row
            data-search={`${r.title} ${r.detail} ${r.reporterName} ${cats[r.category] ?? ""} ${areas[r.area] ?? ""} ${r.adminNote ?? ""}`}
            data-status={r.status}
            data-category={r.category}
            data-area={r.area}
            data-date={r.dayKey}
            className="rounded-xl border border-line bg-surface p-4 target:ring-2 target:ring-brand"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`badge ${CAT_CLS[r.category] ?? CAT_CLS.OTHER}`}>{cats[r.category] ?? r.category}</span>
                  <span className="badge bg-line-soft text-subtle">{areas[r.area] ?? r.area}</span>
                  <span className={`badge ${STATUS_CLS[r.status] ?? STATUS_CLS.OPEN}`}>{statuses[r.status] ?? r.status}</span>
                </div>
                <h3 className="mt-1.5 text-sm font-bold text-ink">{r.title}</h3>
                <div className="text-[11px] text-faint">
                  {new Date(r.createdAt).toLocaleString(locale === "en" ? "en-US" : "th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" })}
                  {admin && <> · {r.reporterName}</>}
                </div>
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-subtle">{r.detail}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint">
              {r.pageUrl && (
                <span>
                  {t.page}: <code className="rounded bg-line-soft px-1">{r.pageUrl}</code>
                </span>
              )}
              {r.device && (
                <span>
                  {t.device}: {r.device}
                </span>
              )}
              {r.attachmentName && (
                <a href={`/api/feedback/${r.id}/attachment`} target="_blank" rel="noopener" className="text-brand-ink hover:underline">
                  📎 {r.attachmentName}
                </a>
              )}
            </div>
            {r.adminNote && (
              <div className="mt-3 rounded-lg border border-brand bg-brand-soft p-3 text-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink">
                  {t.adminReply} {r.handlerName && <span className="font-normal normal-case text-faint">· {t.handledBy(r.handlerName)}</span>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-ink">{r.adminNote}</p>
              </div>
            )}
            {admin && <AdminPanel row={r} />}
          </article>
        ))}
      </div>
    </div>
  );
}

function AdminPanel({ row }: { row: IssueRow }) {
  const { dict } = useLanguage();
  const t = dict.feedback;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(row.status);
  const [note, setNote] = useState(row.adminNote ?? "");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);

  function save() {
    startTransition(async () => {
      const res = await updateIssue(row.id, { status, adminNote: note });
      setMsg(res);
      if (res.ok) router.refresh();
    });
  }
  function remove() {
    if (!confirm(t.deleteConfirm)) return;
    startTransition(async () => {
      const res = await deleteIssue(row.id);
      setMsg(res);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 border-t border-line-soft pt-3">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-subtle hover:bg-line-soft">
          {t.manage}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${status === s ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-muted hover:bg-line-soft"}`}
              >
                {(t.status as Record<string, string>)[s]}
              </button>
            ))}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder={t.replyPlaceholder} className="input min-h-[70px]" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} onClick={save} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
              {t.save}
            </button>
            <button type="button" disabled={pending} onClick={() => setOpen(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-subtle">
              {dict.common.close}
            </button>
            <button type="button" disabled={pending} onClick={remove} className="ml-auto rounded-lg border border-danger px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger-soft disabled:opacity-40">
              {t.delete}
            </button>
          </div>
          {msg && <p className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.message}</p>}
        </div>
      )}
    </div>
  );
}
