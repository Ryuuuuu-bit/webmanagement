"use client";

import { useRef, useState, useTransition } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type Dept = { id: string; name: string; _count?: { users: number } };
type ActionResult = { ok: boolean; message: string };

export default function DepartmentManagement({
  dict,
  departments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
}: {
  dict: Dictionary;
  departments: Dept[];
  createDepartment: (_prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  updateDepartment: (id: string, _prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  deleteDepartment: (id: string) => Promise<ActionResult>;
}) {
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
      const res = await createDepartment(null, formData);
      setCreateResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  function onEditSubmit(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateDepartment(id, null, formData);
      setEditResult({ id, ...res });
      if (res.ok) setEditingId(null);
    });
  }

  function onDelete(id: string, name: string) {
    if (!confirm(dict.masterData.departments.deleteConfirm(name))) return;
    startTransition(async () => {
      const res = await deleteDepartment(id);
      setDeleteResult({ id, ...res });
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{dict.masterData.departments.title}</h2>
      <form ref={formRef} onSubmit={onCreate} className="mt-3 flex flex-wrap items-center gap-3">
        <input name="name" required placeholder={dict.masterData.departments.namePlaceholder} className="input" />
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
          {pending ? dict.common.saving : dict.common.add}
        </button>
        {createResult && <span className={`text-xs ${createResult.ok ? "text-brand-ink" : "text-danger"}`}>{createResult.message}</span>}
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {departments.map((d) =>
          editingId === d.id ? (
            <form key={d.id} onSubmit={(e) => onEditSubmit(d.id, e)} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
              <input name="name" required defaultValue={d.name} className="input" />
              <button type="submit" disabled={pending} className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">{dict.common.save}</button>
              <button type="button" onClick={() => setEditingId(null)} className="text-xs font-semibold text-muted">{dict.common.cancel}</button>
            </form>
          ) : (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2 text-sm first:border-t-0 first:pt-0">
              <span className="font-medium">{d.name}</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setEditingId(d.id)} className="text-xs font-semibold text-brand-ink underline">{dict.common.edit}</button>
                <button disabled={pending} onClick={() => onDelete(d.id, d.name)} className="text-xs font-semibold text-danger disabled:opacity-40">{dict.common.delete}</button>
              </div>
              {editResult?.id === d.id && !editResult.ok && <p className="w-full text-xs text-danger">{editResult.message}</p>}
              {deleteResult?.id === d.id && !deleteResult.ok && <p className="w-full text-xs text-danger">{deleteResult.message}</p>}
            </div>
          )
        )}
        {departments.length === 0 && <p className="text-sm text-faint">{dict.masterData.departments.empty}</p>}
      </div>
    </div>
  );
}
