"use client";

import { useRef, useState, useTransition } from "react";
import { useLanguage } from "./LanguageProvider";

type SemesterRow = { id: string; name: string; startDate: string; endDate: string };
type ActionResult = { ok: boolean; message: string };

function toDateInput(iso: string) {
  return iso.slice(0, 10);
}

export default function SemesterManagement({
  semesters,
  createSemester,
  updateSemester,
  deleteSemester,
}: {
  semesters: SemesterRow[];
  createSemester: (_prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  updateSemester: (id: string, _prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  deleteSemester: (id: string) => Promise<ActionResult>;
}) {
  const { dict } = useLanguage();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [createResult, setCreateResult] = useState<ActionResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<{ id: string } & ActionResult | null>(null);
  const [deleteResult, setDeleteResult] = useState<{ id: string } & ActionResult | null>(null);

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createSemester(null, formData);
      setCreateResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  function onEditSubmit(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateSemester(id, null, formData);
      setEditResult({ id, ...res });
      if (res.ok) setEditingId(null);
    });
  }

  function onDelete(id: string, label: string) {
    if (!confirm(dict.masterData.semesters.deleteConfirm(label))) return;
    startTransition(async () => {
      const res = await deleteSemester(id);
      setDeleteResult({ id, ...res });
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{dict.masterData.semesters.title}</h2>
      <form ref={formRef} onSubmit={onCreate} className="mt-3 flex flex-wrap items-center gap-3">
        <input name="name" required placeholder={dict.masterData.semesters.namePlaceholder} className="input w-36" />
        <input name="startDate" required type="date" className="input" />
        <input name="endDate" required type="date" className="input" />
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
          {pending ? dict.common.saving : dict.common.add}
        </button>
        {createResult && <span className={`text-xs ${createResult.ok ? "text-brand-ink" : "text-danger"}`}>{createResult.message}</span>}
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {semesters.map((s) =>
          editingId === s.id ? (
            <form key={s.id} onSubmit={(e) => onEditSubmit(s.id, e)} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
              <input name="name" required defaultValue={s.name} className="input w-36" />
              <input name="startDate" required type="date" defaultValue={toDateInput(s.startDate)} className="input" />
              <input name="endDate" required type="date" defaultValue={toDateInput(s.endDate)} className="input" />
              <button type="submit" disabled={pending} className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">{dict.common.save}</button>
              <button type="button" onClick={() => setEditingId(null)} className="text-xs font-semibold text-muted">{dict.common.cancel}</button>
            </form>
          ) : (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2 text-sm first:border-t-0 first:pt-0">
              <span>
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 text-faint">
                  {new Date(s.startDate).toLocaleDateString("th-TH")} – {new Date(s.endDate).toLocaleDateString("th-TH")}
                </span>
              </span>
              <div className="flex items-center gap-3">
                <button onClick={() => setEditingId(s.id)} className="text-xs font-semibold text-brand-ink underline">{dict.common.edit}</button>
                <button disabled={pending} onClick={() => onDelete(s.id, s.name)} className="text-xs font-semibold text-danger disabled:opacity-40">{dict.common.delete}</button>
              </div>
              {editResult?.id === s.id && !editResult.ok && <p className="w-full text-xs text-danger">{editResult.message}</p>}
              {deleteResult?.id === s.id && !deleteResult.ok && <p className="w-full text-xs text-danger">{deleteResult.message}</p>}
            </div>
          )
        )}
        {semesters.length === 0 && <p className="text-sm text-faint">{dict.masterData.semesters.empty}</p>}
      </div>
    </div>
  );
}
