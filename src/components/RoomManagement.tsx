"use client";

import { useRef, useState, useTransition } from "react";
import { useLanguage } from "./LanguageProvider";

type RoomRow = { id: string; name: string; building: string };
type ActionResult = { ok: boolean; message: string };

export default function RoomManagement({
  rooms,
  createRoom,
  updateRoom,
  deleteRoom,
}: {
  rooms: RoomRow[];
  createRoom: (_prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  updateRoom: (id: string, _prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  deleteRoom: (id: string) => Promise<ActionResult>;
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
      const res = await createRoom(null, formData);
      setCreateResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  function onEditSubmit(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateRoom(id, null, formData);
      setEditResult({ id, ...res });
      if (res.ok) setEditingId(null);
    });
  }

  function onDelete(id: string, label: string) {
    if (!confirm(dict.masterData.rooms.deleteConfirm(label))) return;
    startTransition(async () => {
      const res = await deleteRoom(id);
      setDeleteResult({ id, ...res });
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{dict.masterData.rooms.title}</h2>
      <form ref={formRef} onSubmit={onCreate} className="mt-3 flex flex-wrap items-center gap-3">
        <input name="name" required placeholder={dict.masterData.rooms.namePlaceholder} className="input" />
        <input name="building" required placeholder={dict.masterData.rooms.buildingPlaceholder} className="input" />
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
          {pending ? dict.common.saving : dict.common.add}
        </button>
        {createResult && <span className={`text-xs ${createResult.ok ? "text-brand-ink" : "text-danger"}`}>{createResult.message}</span>}
      </form>

      <div className="mt-4 flex flex-col gap-2">
        {rooms.map((r) =>
          editingId === r.id ? (
            <form key={r.id} onSubmit={(e) => onEditSubmit(r.id, e)} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
              <input name="name" required defaultValue={r.name} className="input" />
              <input name="building" required defaultValue={r.building} className="input" />
              <button type="submit" disabled={pending} className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">{dict.common.save}</button>
              <button type="button" onClick={() => setEditingId(null)} className="text-xs font-semibold text-muted">{dict.common.cancel}</button>
            </form>
          ) : (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2 text-sm first:border-t-0 first:pt-0">
              <span><span className="font-medium">{r.name}</span> <span className="ml-1 text-faint">({r.building})</span></span>
              <div className="flex items-center gap-3">
                <button onClick={() => setEditingId(r.id)} className="text-xs font-semibold text-brand-ink underline">{dict.common.edit}</button>
                <button disabled={pending} onClick={() => onDelete(r.id, r.name)} className="text-xs font-semibold text-danger disabled:opacity-40">{dict.common.delete}</button>
              </div>
              {editResult?.id === r.id && !editResult.ok && <p className="w-full text-xs text-danger">{editResult.message}</p>}
              {deleteResult?.id === r.id && !deleteResult.ok && <p className="w-full text-xs text-danger">{deleteResult.message}</p>}
            </div>
          )
        )}
        {rooms.length === 0 && <p className="text-sm text-faint">{dict.masterData.rooms.empty}</p>}
      </div>
    </div>
  );
}
