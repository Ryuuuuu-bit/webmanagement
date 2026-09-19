"use client";

import { useRef, useState, useTransition } from "react";
import { useLanguage } from "@/components/LanguageProvider";

type Loc = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number };
type ActionResult = { ok: boolean; message: string };

export default function LocationManagement({
  locations,
  createLocation,
  updateLocation,
  deleteLocation,
}: {
  locations: Loc[];
  createLocation: (_prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  updateLocation: (id: string, _prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  deleteLocation: (id: string) => Promise<void>;
}) {
  const { dict } = useLanguage();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [createResult, setCreateResult] = useState<ActionResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<{ id: string } & ActionResult | null>(null);

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createLocation(null, formData);
      setCreateResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  function onEditSubmit(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateLocation(id, null, formData);
      setEditResult({ id, ...res });
      if (res.ok) setEditingId(null);
    });
  }

  function onDelete(id: string, name: string) {
    if (!confirm(dict.locations.deleteConfirm(name))) return;
    startTransition(() => deleteLocation(id));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{dict.locations.addTitle}</h2>
        <p className="mt-1 text-sm text-muted">
          {dict.locations.addHint}
        </p>
        <form ref={formRef} onSubmit={onCreate} className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            <input name="name" required placeholder={dict.locations.namePlaceholder} className="input" />
            <input name="latitude" required type="number" step="any" placeholder={dict.locations.latitudePlaceholder} className="input" />
            <input name="longitude" required type="number" step="any" placeholder={dict.locations.longitudePlaceholder} className="input" />
            <input name="radiusMeters" required type="number" defaultValue={150} min={10} max={20000} placeholder={dict.locations.radiusPlaceholder} className="input" />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? dict.common.saving : dict.locations.addButton}
            </button>
            {createResult && (
              <span className={`text-sm ${createResult.ok ? "text-brand-ink" : "text-danger"}`}>{createResult.message}</span>
            )}
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{dict.locations.allTitle}</h2>
        {locations.length === 0 && (
          <p className="mt-2 text-sm text-danger">{dict.locations.none}</p>
        )}
        <div className="mt-3 flex flex-col gap-3">
          {locations.map((loc) =>
            editingId === loc.id ? (
              <form key={loc.id} onSubmit={(e) => onEditSubmit(loc.id, e)} className="grid grid-cols-1 gap-3 rounded-lg border border-line p-3 sm:grid-cols-2 md:grid-cols-5">
                <input name="name" required defaultValue={loc.name} className="input" />
                <input name="latitude" required type="number" step="any" defaultValue={loc.latitude} className="input" />
                <input name="longitude" required type="number" step="any" defaultValue={loc.longitude} className="input" />
                <input name="radiusMeters" required type="number" defaultValue={loc.radiusMeters} min={10} max={20000} className="input" />
                <div className="flex items-center gap-2">
                  <button type="submit" disabled={pending} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{dict.common.save}</button>
                  <button type="button" onClick={() => setEditingId(null)} className="text-xs font-semibold text-muted">{dict.common.cancel}</button>
                </div>
              </form>
            ) : (
              <div key={loc.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3 text-sm first:border-t-0 first:pt-0">
                <div>
                  <span className="font-semibold">{loc.name}</span>
                  <span className="ml-2 text-faint">
                    ({loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}) {dict.locations.radiusLabel} {loc.radiusMeters} {dict.locations.metersShort}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setEditingId(loc.id)} className="text-xs font-semibold text-brand-ink underline">{dict.common.edit}</button>
                  <button disabled={pending} onClick={() => onDelete(loc.id, loc.name)} className="text-xs font-semibold text-danger disabled:opacity-40">{dict.common.delete}</button>
                </div>
                {editResult?.id === loc.id && !editResult.ok && (
                  <p className="w-full text-xs text-danger">{editResult.message}</p>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
