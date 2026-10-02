"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useLanguage } from "./LanguageProvider";

export type SchoolEventRow = {
  id: string;
  title: string;
  detail: string | null;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  isHoliday: boolean;
  siteIds: string[]; // [] = every school
  siteNames: string[];
};
type ActionResult = { ok: boolean; message: string };

/** "YYYY-MM-DD" keys of the month grid, Monday-first, padded to whole weeks. */
export function monthGrid(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // 0 = Monday
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((lead + days) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => new Date(Date.UTC(y, m - 1, 1 - lead + i)).toISOString().slice(0, 10));
}

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/**
 * Month grid + the month's events. Admin adds / edits / deletes; an event
 * targets every school (no box ticked) or the ticked schools, and editing
 * or deleting it applies to all of them at once. Teachers only read.
 */
export default function SchoolCalendar({
  month,
  todayKey,
  events,
  sites,
  siteFilter,
  isAdmin,
  createEvent,
  updateEvent,
  deleteEvent,
}: {
  month: string;
  todayKey: string;
  events: SchoolEventRow[];
  sites: { id: string; name: string }[];
  siteFilter: string;
  isAdmin: boolean;
  createEvent: (_prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  updateEvent: (id: string, _prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  deleteEvent: (id: string) => Promise<ActionResult>;
}) {
  const { dict, locale } = useLanguage();
  const t = dict.schoolCalendar;
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id: string | null; start: string; end: string; row?: SchoolEventRow } | null>(null);
  const [formSites, setFormSites] = useState<string[]>([]);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const grid = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, SchoolEventRow[]>();
    for (const key of grid) map.set(key, events.filter((e) => e.start <= key && key <= e.end));
    return map;
  }, [grid, events]);
  const monthEvents = events
    .filter((e) => e.start.slice(0, 7) <= month && month <= e.end.slice(0, 7))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const listed = selected ? monthEvents.filter((e) => e.start <= selected && selected <= e.end) : monthEvents;

  const intl = locale === "en" ? "en-US" : "th-TH";
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(intl, { month: "long", year: "numeric", timeZone: "UTC" });
  const fmt = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString(intl, { day: "numeric", month: "short", timeZone: "UTC" });
  const range = (e: SchoolEventRow) => (e.start === e.end ? fmt(e.start) : `${fmt(e.start)} – ${fmt(e.end)}`);
  const href = (m: string) => `/calendar?month=${m}${siteFilter ? `&site=${siteFilter}` : ""}`;
  const schoolsLabel = (e: SchoolEventRow) => (e.siteIds.length === 0 ? t.allSchools : e.siteNames.join(", "));

  function open(next: { id: string | null; start: string; end: string; row?: SchoolEventRow }) {
    setResult(null);
    setFormSites(next.row ? next.row.siteIds : siteFilter ? [siteFilter] : []);
    setEditing(next);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    fd.delete("siteIds");
    for (const id of formSites) fd.append("siteIds", id);
    startTransition(async () => {
      const res = editing.id ? await updateEvent(editing.id, null, fd) : await createEvent(null, fd);
      setResult(res);
      if (res.ok) setEditing(null);
    });
  }

  function onDelete(row: SchoolEventRow) {
    if (!confirm(t.deleteConfirm(row.title, schoolsLabel(row)))) return;
    startTransition(async () => {
      setResult(await deleteEvent(row.id));
      setEditing(null);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {isAdmin && (
        <div className="flex justify-end">
          <button type="button" onClick={() => open({ id: null, start: selected ?? todayKey, end: selected ?? todayKey })} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
            + {t.add}
          </button>
        </div>
      )}

      {result && <p className={`text-sm ${result.ok ? "text-brand-ink" : "text-danger"}`}>{result.message}</p>}

      {editing && isAdmin && (
        <form key={editing.id ?? `new-${editing.start}`} onSubmit={onSubmit} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{editing.id ? t.editTitle : t.addTitle}</h2>
          <input name="title" required maxLength={200} defaultValue={editing.row?.title ?? ""} placeholder={t.titlePlaceholder} className="input" />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              {t.from}
              <input name="startDate" type="date" required defaultValue={editing.start} className="input" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              {t.to}
              <input name="endDate" type="date" defaultValue={editing.end} className="input" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input name="isHoliday" type="checkbox" defaultChecked={editing.row?.isHoliday ?? false} className="h-4 w-4 accent-brand" />
              {t.isHoliday}
            </label>
          </div>
          <SitePicker sites={sites} value={formSites} onChange={setFormSites} />
          <p className="text-[11px] text-faint">{t.holidayHint}</p>
          <textarea name="detail" rows={2} maxLength={2000} defaultValue={editing.row?.detail ?? ""} placeholder={t.detailPlaceholder} className="input" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? dict.common.saving : dict.common.save}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-line-soft">
              {dict.common.cancel}
            </button>
            {editing.row && (
              <button type="button" disabled={pending} onClick={() => onDelete(editing.row!)} className="ml-auto rounded-lg px-3 py-2 text-sm font-semibold text-danger hover:bg-line-soft disabled:opacity-40">
                {dict.common.delete}
              </button>
            )}
          </div>
        </form>
      )}

      <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Link href={href(shiftMonth(month, -1))} className="rounded-lg border border-line px-3 py-1.5 text-sm text-subtle hover:bg-line-soft" aria-label={t.prev}>‹</Link>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold">{monthLabel}</h2>
            {month !== todayKey.slice(0, 7) && (
              <Link href={href(todayKey.slice(0, 7))} className="text-xs font-medium text-brand-ink hover:underline">{t.today}</Link>
            )}
          </div>
          <Link href={href(shiftMonth(month, 1))} className="rounded-lg border border-line px-3 py-1.5 text-sm text-subtle hover:bg-line-soft" aria-label={t.next}>›</Link>
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line text-xs">
          {dict.day.mini.map((d) => (
            <div key={d} className="bg-surface py-1.5 text-center font-semibold text-faint">{d}</div>
          ))}
          {grid.map((key) => {
            const list = byDay.get(key) ?? [];
            const inMonth = key.slice(0, 7) === month;
            const holiday = list.some((e) => e.isHoliday);
            const isSel = selected === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(isSel ? null : key)}
                className={`flex min-h-[64px] flex-col items-stretch gap-0.5 p-1 text-left sm:min-h-[88px] ${holiday ? "bg-danger-soft" : "bg-surface"} ${inMonth ? "" : "opacity-40"} ${isSel ? "ring-2 ring-inset ring-brand" : ""}`}
              >
                <span className={`text-[11px] font-semibold ${key === todayKey ? "w-fit rounded-full bg-brand px-1.5 text-white" : holiday ? "text-danger" : "text-subtle"}`}>
                  {Number(key.slice(8))}
                </span>
                {list.slice(0, 3).map((e) => (
                  <span key={e.id} className={`truncate rounded px-1 text-[10px] leading-4 sm:text-[11px] ${e.isHoliday ? "bg-danger text-white" : "bg-info-soft text-info"}`} title={`${e.title} · ${schoolsLabel(e)}`}>
                    {e.title}
                  </span>
                ))}
                {list.length > 3 && <span className="text-[10px] text-faint">+{list.length - 3}</span>}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-faint">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-danger" />{t.legendHoliday}</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-info-soft" />{t.legendEvent}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-base font-bold">{selected ? t.eventsOn(fmt(selected)) : t.eventsInMonth}</h2>
          {selected && (
            <button type="button" onClick={() => setSelected(null)} className="text-xs font-medium text-brand-ink hover:underline">{t.showAll}</button>
          )}
        </div>
        {listed.length === 0 && <p className="text-sm text-faint">{t.empty}</p>}
        <ul className="flex flex-col">
          {listed.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-line-soft py-2.5 first:border-t-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{e.title}</span>
                  {e.isHoliday && <span className="badge bg-danger-soft text-danger">{t.holiday}</span>}
                  <span className="badge bg-line-soft text-subtle">{schoolsLabel(e)}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted">{range(e)}</div>
                {e.detail && <p className="mt-1 whitespace-pre-line text-sm text-subtle">{e.detail}</p>}
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => { open({ id: e.id, start: e.start, end: e.end, row: e }); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  className="rounded px-1.5 py-1 text-xs font-semibold text-brand-ink underline hover:bg-line-soft"
                >
                  {dict.common.edit}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** "Every school" or a set of ticked schools. */
export function SitePicker({ sites, value, onChange }: { sites: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const { dict } = useLanguage();
  const t = dict.schoolCalendar;
  const all = value.length === 0;
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-xs text-muted">{t.schools}</legend>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={all}
          onClick={() => onChange([])}
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${all ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-subtle"}`}
        >
          {t.allSchools}
        </button>
        {sites.map((s) => {
          const on = value.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== s.id) : [...value, s.id])}
              className={`rounded-full border px-3 py-1 text-xs ${on ? "border-brand bg-brand-soft font-semibold text-brand-ink" : "border-line text-subtle"}`}
            >
              {on ? "✓ " : ""}{s.name}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-faint">{all ? t.schoolsAllHint : t.schoolsSomeHint(value.length)}</p>
    </fieldset>
  );
}
