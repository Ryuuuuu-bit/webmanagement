"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLanguage } from "./LanguageProvider";

type Site = { id: string; name: string };

/**
 * Admin → user card: the extra sites a teacher may also check in/out at
 * (besides the primary site), for teachers who move between sites during
 * the day. Small popover with checkboxes; saves the whole list at once.
 */
export default function ExtraSitesPicker({
  userId,
  primaryId,
  sites,
  initial,
  save,
}: {
  userId: string;
  primaryId: string | null;
  sites: Site[];
  initial: string[];
  save: (userId: string, locationIds: string[]) => Promise<{ ok: boolean; message: string }>;
}) {
  const { dict } = useLanguage();
  const t = dict.users.extraSites;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(initial);
  const [saved, setSaved] = useState<string[]>(initial);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const options = sites.filter((s) => s.id !== primaryId);
  const count = saved.filter((id) => id !== primaryId).length;

  function onSave() {
    startTransition(async () => {
      const res = await save(userId, selected);
      setResult(res);
      if (res.ok) {
        setSaved(selected);
        setOpen(false);
      }
    });
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setSelected(saved);
          setResult(null);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        title={t.hint}
        className="rounded-lg border border-line-strong px-2 py-1 text-xs text-subtle hover:bg-line-soft"
      >
        {t.button(count)}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-64 max-w-[calc(100vw-3rem)] rounded-xl lg:left-auto lg:right-0 border border-line bg-surface p-3 shadow-xl">
          <div className="text-xs font-semibold">{t.title}</div>
          <p className="mt-0.5 text-[11px] text-muted">{t.hint}</p>
          {options.length === 0 ? (
            <p className="mt-2 text-xs text-faint">{t.none}</p>
          ) : (
            <div className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
              {options.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-line-soft">
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2.5 py-1 text-xs text-muted hover:bg-line-soft">
              {dict.common.cancel}
            </button>
            <button type="button" disabled={pending || options.length === 0} onClick={onSave} className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
              {pending ? dict.common.saving : dict.common.save}
            </button>
          </div>
          {result && !result.ok && <p className="mt-1 text-[11px] text-danger">{result.message}</p>}
        </div>
      )}
      {result?.ok && !open && <span className="sr-only" role="status">{result.message}</span>}
    </div>
  );
}
