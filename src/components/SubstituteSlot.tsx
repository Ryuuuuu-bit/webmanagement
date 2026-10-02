"use client";

import { useState, useTransition } from "react";
import { useLanguage } from "./LanguageProvider";
import type { Slot } from "@/lib/substitutes";

type ActionResult = { ok: boolean; message: string };

/** One class of an absent teacher: who covers it (booking) or the free teachers to pick from. */
export default function SubstituteSlot({
  dateKey,
  slot,
  assign,
  cancel,
}: {
  dateKey: string;
  slot: Slot;
  assign: (dateKey: string, scheduleId: string, substituteId: string) => Promise<ActionResult>;
  cancel: (id: string) => Promise<ActionResult>;
}) {
  const { dict } = useLanguage();
  const t = dict.substitutes;
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [showAll, setShowAll] = useState(false);
  const b = slot.booking;
  const needsPick = !b || b.unavailable;
  const list = showAll ? slot.candidates : slot.candidates.slice(0, 8);

  const doAssign = (id: string, name: string) => {
    if (b && !confirm(t.replaceConfirm(b.name, name))) return;
    startTransition(async () => setResult(await assign(dateKey, slot.scheduleId, id)));
  };
  const doCancel = () => {
    if (!b || !confirm(t.cancelConfirm(b.name))) return;
    startTransition(async () => setResult(await cancel(b.id)));
  };

  return (
    <div className={`rounded-xl border p-3 ${needsPick ? "border-warn" : "border-ok bg-ok-soft"}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-semibold">{slot.start}–{slot.end}</span>
        <span className="font-semibold">{slot.courseCode}</span>
        <span className="text-subtle">{slot.courseName}</span>
        {slot.gradeLevel ? <span className="badge bg-info-soft text-info">{dict.grades[slot.gradeLevel]}</span> : <span className="text-xs text-faint">{t.noGrade}</span>}
        <span className="text-xs text-faint">{t.room(slot.room)}</span>
      </div>

      {b && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className={`badge ${b.unavailable ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok"}`}>
            {b.unavailable ? t.bookedUnavailable(b.name) : t.bookedBy(b.name)}
          </span>
          <button type="button" disabled={pending} onClick={doCancel} className="rounded px-1.5 py-1 text-xs font-semibold text-danger hover:bg-line-soft disabled:opacity-40">
            {t.cancelBooking}
          </button>
        </div>
      )}

      <div className="mt-2 text-xs text-muted">{b && !b.unavailable ? t.changeTo : t.candidates(slot.candidates.length)}</div>
      {slot.candidates.length === 0 ? (
        needsPick && <p className="mt-1 text-sm text-danger">{t.noCandidate}</p>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {list.map((c, i) => (
            <button
              key={c.id}
              type="button"
              disabled={pending}
              onClick={() => doAssign(c.id, c.name)}
              title={t.assignTo(c.name)}
              className={`rounded-full border px-2.5 py-1 text-xs hover:bg-brand-soft disabled:opacity-50 ${i === 0 && needsPick ? "border-brand bg-brand-soft font-semibold text-brand-ink" : "border-line text-subtle"}`}
            >
              + {c.name} · {t.classesToday(c.classesToday)}
            </button>
          ))}
          {slot.candidates.length > 8 && !showAll && (
            <button type="button" onClick={() => setShowAll(true)} className="px-1 py-1 text-xs font-medium text-brand-ink hover:underline">
              {t.showMore(slot.candidates.length - 8)}
            </button>
          )}
        </div>
      )}
      {result && <p className={`mt-1.5 text-xs ${result.ok ? "text-ok" : "text-danger"}`}>{result.message}</p>}
    </div>
  );
}
