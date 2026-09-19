"use client";

import { useRef, useState, useTransition } from "react";
import { useLanguage } from "./LanguageProvider";

type CourseRow = { id: string; code: string; name: string };
type ActionResult = { ok: boolean; message: string };

export default function CourseManagement({
  courses,
  createCourse,
  updateCourse,
  deleteCourse,
}: {
  courses: CourseRow[];
  createCourse: (_prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  updateCourse: (id: string, _prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  deleteCourse: (id: string) => Promise<ActionResult>;
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
      const res = await createCourse(null, formData);
      setCreateResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  function onEditSubmit(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateCourse(id, null, formData);
      setEditResult({ id, ...res });
      if (res.ok) setEditingId(null);
    });
  }

  function onDelete(id: string, label: string) {
    if (!confirm(dict.masterData.courses.deleteConfirm(label))) return;
    startTransition(async () => {
      const res = await deleteCourse(id);
      setDeleteResult({ id, ...res });
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{dict.masterData.courses.title}</h2>
      <form ref={formRef} onSubmit={onCreate} className="mt-3 flex flex-wrap items-center gap-3">
        <input name="code" required placeholder={dict.masterData.courses.codePlaceholder} className="input w-36" />
        <input name="name" required placeholder={dict.masterData.courses.namePlaceholder} className="input" />
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
          {pending ? dict.common.saving : dict.common.add}
        </button>
        {createResult && <span className={`text-xs ${createResult.ok ? "text-brand-ink" : "text-danger"}`}>{createResult.message}</span>}
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {courses.map((c) =>
          editingId === c.id ? (
            <form key={c.id} onSubmit={(e) => onEditSubmit(c.id, e)} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
              <input name="code" required defaultValue={c.code} className="input w-36" />
              <input name="name" required defaultValue={c.name} className="input" />
              <button type="submit" disabled={pending} className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">{dict.common.save}</button>
              <button type="button" onClick={() => setEditingId(null)} className="text-xs font-semibold text-muted">{dict.common.cancel}</button>
            </form>
          ) : (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2 text-sm first:border-t-0 first:pt-0">
              <span><span className="font-mono font-semibold">{c.code}</span> <span className="ml-1">{c.name}</span></span>
              <div className="flex items-center gap-3">
                <button onClick={() => setEditingId(c.id)} className="text-xs font-semibold text-brand-ink underline">{dict.common.edit}</button>
                <button disabled={pending} onClick={() => onDelete(c.id, `${c.code} ${c.name}`)} className="text-xs font-semibold text-danger disabled:opacity-40">{dict.common.delete}</button>
              </div>
              {editResult?.id === c.id && !editResult.ok && <p className="w-full text-xs text-danger">{editResult.message}</p>}
              {deleteResult?.id === c.id && !deleteResult.ok && <p className="w-full text-xs text-danger">{deleteResult.message}</p>}
            </div>
          )
        )}
        {courses.length === 0 && <p className="text-sm text-faint">{dict.masterData.courses.empty}</p>}
      </div>
    </div>
  );
}
