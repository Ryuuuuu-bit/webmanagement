"use client";

import { useRef, useState, useTransition } from "react";
import { useLanguage } from "./LanguageProvider";

type TypeRow = { id: string; name: string; remindDays: string; notifyTeacher: boolean; count: number };
type ActionResult = { ok: boolean; message: string };

/** Admin-defined document kinds and when each one starts reminding (days before expiry). */
export default function DocumentTypeManagement({
  types,
  createType,
  updateType,
  deleteType,
}: {
  types: TypeRow[];
  createType: (_prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  updateType: (id: string, _prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  deleteType: (id: string) => Promise<ActionResult>;
}) {
  const { dict } = useLanguage();
  const t = dict.documents.types;
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createType(null, fd);
      setResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  function onEdit(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateType(id, null, fd);
      setResult(res);
      if (res.ok) setEditingId(null);
    });
  }

  function onDelete(row: TypeRow) {
    if (!confirm(t.deleteConfirm(row.name))) return;
    startTransition(async () => setResult(await deleteType(row.id)));
  }

  const fields = (row?: TypeRow) => (
    <>
      <input name="name" required maxLength={100} defaultValue={row?.name ?? ""} placeholder={t.namePlaceholder} className="input w-48" />
      <label className="flex items-center gap-1.5 text-xs text-muted">
        {t.remindLabel}
        <input name="remindDays" defaultValue={row?.remindDays ?? "90,60"} className="input w-24" title={t.remindHint} />
        {t.daysBefore}
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <input name="notifyTeacher" type="checkbox" defaultChecked={row?.notifyTeacher ?? true} className="h-4 w-4 accent-brand" />
        {t.notifyTeacher}
      </label>
    </>
  );

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{t.title}</h2>
      <p className="mt-1 text-sm text-muted">{t.hint}</p>
      <form ref={formRef} onSubmit={onCreate} className="mt-3 flex flex-wrap items-center gap-3">
        {fields()}
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
          {pending ? dict.common.saving : dict.common.add}
        </button>
      </form>
      {result && <p className={`mt-2 text-xs ${result.ok ? "text-brand-ink" : "text-danger"}`}>{result.message}</p>}

      <div className="mt-4 flex flex-col gap-2">
        {types.map((row) =>
          editingId === row.id ? (
            <form key={row.id} onSubmit={(e) => onEdit(row.id, e)} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
              {fields(row)}
              <button type="submit" disabled={pending} className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">{dict.common.save}</button>
              <button type="button" onClick={() => setEditingId(null)} className="rounded px-1.5 py-1.5 text-xs font-semibold text-muted hover:bg-line-soft">{dict.common.cancel}</button>
            </form>
          ) : (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2 text-sm first:border-t-0 first:pt-0">
              <span>
                <span className="font-medium">{row.name}</span>
                <span className="ml-2 text-xs text-faint">{t.summary(row.remindDays, row.count)}</span>
                {!row.notifyTeacher && <span className="ml-2 text-xs text-faint">· {t.adminOnly}</span>}
              </span>
              <div className="flex items-center gap-3">
                <button onClick={() => setEditingId(row.id)} className="rounded px-1.5 py-1.5 text-xs font-semibold text-brand-ink underline hover:bg-line-soft">{dict.common.edit}</button>
                <button disabled={pending} onClick={() => onDelete(row)} className="rounded px-1.5 py-1.5 text-xs font-semibold text-danger disabled:opacity-40 hover:bg-line-soft">{dict.common.delete}</button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
