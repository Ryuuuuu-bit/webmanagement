"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import { updateAttendance, type AttendanceStatusValue } from "@/actions/records";

const STATUSES: AttendanceStatusValue[] = ["PENDING", "ON_TIME", "LATE", "ABSENT", "LEAVE"];

/**
 * "แก้ไข" for one attendance row — a small modal with check-in / check-out
 * time ("HH:MM", Thai time, blank = clear) and status. Used on the admin
 * check-in overview and the per-user history page.
 */
export default function EditAttendanceButton({
  id,
  label,
  checkin,
  checkout,
  status,
}: {
  id: string;
  /** e.g. "อ.สมชาย · 20 ก.ย. 2569" shown in the modal header. */
  label: string;
  /** Current values as "HH:MM" in Thai time ("" when not stamped). */
  checkin: string;
  checkout: string;
  status: string;
}) {
  const { dict } = useLanguage();
  const t = dict.history;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ checkin, checkout, status: status as AttendanceStatusValue });
  const [error, setError] = useState<string | null>(null);

  function onOpen() {
    setForm({ checkin, checkout, status: status as AttendanceStatusValue });
    setError(null);
    setOpen(true);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateAttendance(id, form);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="whitespace-nowrap rounded-lg border border-line px-2 py-0.5 text-[11px] font-semibold text-brand-ink hover:bg-line-soft"
      >
        {dict.common.edit}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold">{t.editTitle}</h3>
                <p className="text-xs text-muted">{label}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-faint hover:text-subtle">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-faint">
                {t.colCheckin}
                <input type="time" value={form.checkin} onChange={(e) => setForm({ ...form, checkin: e.target.value })} className="input text-sm text-ink" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-faint">
                {t.colCheckout}
                <input type="time" value={form.checkout} onChange={(e) => setForm({ ...form, checkout: e.target.value })} className="input text-sm text-ink" />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs text-faint">
                {t.colStatus}
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AttendanceStatusValue })} className="input text-sm text-ink">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{dict.status.attendance[s]}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-2 text-[11px] text-faint">{t.editHint}</p>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-subtle">
                {dict.common.cancel}
              </button>
              <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {pending ? dict.common.saving : dict.common.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
