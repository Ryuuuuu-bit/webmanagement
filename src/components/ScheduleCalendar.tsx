"use client";

import { useMemo, useState, useTransition } from "react";
import { formatDayTime } from "@/lib/date";
import { useLanguage } from "./LanguageProvider";

type Option = { id: string; name?: string; code?: string; building?: string };
type ScheduleRow = {
  id: string;
  teacherId: string;
  courseId: string;
  roomId: string;
  semesterId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  note: string | null;
  course: { code: string; name: string };
  room: { name: string };
};
type ActionResult = { ok: boolean; message: string };

const GRID_START_HOUR = 7;
const GRID_END_HOUR = 19;
const HOUR_HEIGHT = 52; // px
const HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);

// A small fixed palette, colors picked by a hash of the course id so the
// same course always gets the same color across the whole calendar. These
// stay fixed regardless of light/dark theme — they're identity tags, not
// surface colors.
const PALETTE = [
  "#6264A7", // purple (MS-Teams-ish)
  "#C4314B", // red
  "#DA7C22", // orange
  "#498205", // green
  "#0078D4", // blue
  "#B4009E", // magenta
  "#00B7C3", // teal
  "#986F0B", // gold
];

function colorFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function toMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

type Draft = { dayOfWeek: number; startTime: string; endTime: string } | null;

export default function ScheduleCalendar({
  schedules,
  teachers,
  selfTeacherId,
  courses,
  rooms,
  semesters,
  weekDayNumbers,
  todayIndex,
  currentUserId,
  isAdmin,
  createSchedule,
  updateScheduleNote,
  deleteSchedule,
}: {
  schedules: ScheduleRow[];
  /** Admin mode: full teacher list to switch between calendars. */
  teachers?: Option[];
  /** Member mode: only this teacher's calendar, no switcher. */
  selfTeacherId?: string;
  courses: Option[];
  rooms: Option[];
  semesters: Option[];
  weekDayNumbers: number[];
  todayIndex: number;
  currentUserId: string;
  isAdmin: boolean;
  createSchedule: (formData: FormData) => Promise<ActionResult>;
  updateScheduleNote: (id: string, note: string) => Promise<ActionResult>;
  deleteSchedule: (id: string) => Promise<ActionResult>;
}) {
  const { dict, locale } = useLanguage();
  const [viewTeacherId, setViewTeacherId] = useState(selfTeacherId ?? teachers?.[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ScheduleRow | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(
    () => schedules.filter((s) => s.teacherId === (isAdmin ? viewTeacherId : selfTeacherId)),
    [schedules, viewTeacherId, isAdmin, selfTeacherId]
  );

  const totalHeight = HOURS.length * HOUR_HEIGHT;

  function openBlankModal() {
    setFormError(null);
    setDraft({ dayOfWeek: todayIndex >= 0 && todayIndex <= 6 ? todayIndex : 0, startTime: "08:30", endTime: "09:30" });
  }

  function openCellModal(dayOfWeek: number, hour: number) {
    setFormError(null);
    setDraft({ dayOfWeek, startTime: `${pad(hour)}:00`, endTime: `${pad(hour + 1)}:00` });
  }

  function openDetail(s: ScheduleRow) {
    setNoteError(null);
    setNoteDraft(s.note ?? "");
    setDetail(s);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (isAdmin) formData.set("teacherId", viewTeacherId);
    startTransition(async () => {
      const res = await createSchedule(formData);
      if (res.ok) {
        setDraft(null);
        setFormError(null);
      } else {
        setFormError(res.message);
      }
    });
  }

  function onSaveNote() {
    if (!detail) return;
    startTransition(async () => {
      const res = await updateScheduleNote(detail.id, noteDraft);
      if (res.ok) {
        setDetail(null);
      } else {
        setNoteError(res.message);
      }
    });
  }

  function onDelete(id: string) {
    if (!confirm(dict.schedule.deleteConfirm)) return;
    startTransition(async () => {
      await deleteSchedule(id);
      setDetail(null);
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {isAdmin ? (
          <select
            value={viewTeacherId}
            onChange={(e) => setViewTeacherId(e.target.value)}
            className="input w-auto"
          >
            {teachers!.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        ) : (
          <div className="text-sm font-semibold text-subtle">{dict.schedule.myScheduleLabel}</div>
        )}
        <button
          onClick={openBlankModal}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white"
        >
          {dict.schedule.addButton}
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[820px] grid-cols-[56px_repeat(7,1fr)]">
          <div />
          {dict.day.short.map((d, i) => (
            <div key={d} className="pb-2 text-center">
              <div className={`text-lg font-semibold ${i === todayIndex ? "text-warn" : ""}`}>
                {weekDayNumbers[i]}
              </div>
              <div className="text-[11px] text-faint">{d}</div>
            </div>
          ))}

          <div className="relative" style={{ height: totalHeight }}>
            {HOURS.map((h) => (
              <div key={h} className="absolute left-0 right-0 -translate-y-2 text-right text-[10px] text-faint" style={{ top: (h - GRID_START_HOUR) * HOUR_HEIGHT }}>
                {pad(h)}:00
              </div>
            ))}
          </div>

          {dict.day.short.map((_, dayIndex) => {
            const dayEvents = visible.filter((s) => s.dayOfWeek === dayIndex);
            return (
              <div key={dayIndex} className="relative border-l border-line-soft" style={{ height: totalHeight }}>
                {HOURS.map((h, hi) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => openCellModal(dayIndex, h)}
                    className="absolute left-0 right-0 border-t border-line-soft transition-colors hover:bg-line-soft"
                    style={{ top: hi * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    aria-label={dict.schedule.addAriaLabel(formatDayTime(dict, locale, dayIndex, `${pad(h)}:00`))}
                  />
                ))}
                {dayEvents.map((s) => {
                  const top = Math.max(0, ((toMinutes(s.startTime) - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT);
                  const height = Math.max(20, ((toMinutes(s.endTime) - toMinutes(s.startTime)) / 60) * HOUR_HEIGHT);
                  const canManage = isAdmin || s.teacherId === currentUserId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => openDetail(s)}
                      className="group absolute left-0.5 right-0.5 z-10 overflow-hidden rounded-md p-1.5 text-left text-[11px] leading-tight text-white shadow"
                      style={{ top, height, backgroundColor: colorFor(s.courseId) }}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="font-semibold">{s.course.code}</span>
                        {s.note && <span className="text-[9px] leading-none opacity-80" title={dict.schedule.hasNoteTitle}>📝</span>}
                      </div>
                      <div className="text-white/85">{s.startTime}–{s.endTime}</div>
                      <div className="truncate text-white/70">{s.room.name}</div>
                      {canManage && <span className="sr-only">{dict.schedule.editableHint}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold">{dict.schedule.addTitle}</h3>
              <button onClick={() => setDraft(null)} className="text-faint hover:text-subtle">✕</button>
            </div>
            <form onSubmit={onSubmit} className="flex flex-col gap-3 text-sm">
              {isAdmin ? (
                <Field label={dict.schedule.fieldTeacher}>
                  <select value={viewTeacherId} onChange={(e) => setViewTeacherId(e.target.value)} className="input w-full">
                    {teachers!.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
              ) : (
                <input type="hidden" name="teacherId" value={selfTeacherId} />
              )}
              <Field label={dict.schedule.fieldCourse}>
                <select name="courseId" required defaultValue="" className="input w-full">
                  <option value="" disabled>{dict.schedule.selectCourse}</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
                </select>
              </Field>
              <Field label={dict.schedule.fieldRoom}>
                <select name="roomId" required defaultValue="" className="input w-full">
                  <option value="" disabled>{dict.schedule.selectRoom}</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
              <Field label={dict.schedule.fieldSemester}>
                <select name="semesterId" required defaultValue="" className="input w-full">
                  <option value="" disabled>{dict.schedule.selectSemester}</option>
                  {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label={dict.schedule.fieldDay}>
                <select name="dayOfWeek" required defaultValue={draft.dayOfWeek} className="input w-full">
                  {dict.day.short.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={dict.schedule.fieldStart}>
                  <input type="time" name="startTime" required defaultValue={draft.startTime} className="input w-full" />
                </Field>
                <Field label={dict.schedule.fieldEnd}>
                  <input type="time" name="endTime" required defaultValue={draft.endTime} className="input w-full" />
                </Field>
              </div>
              <Field label={dict.schedule.fieldNote}>
                <textarea name="note" rows={2} placeholder={dict.schedule.notePlaceholder} className="input w-full resize-none" />
              </Field>
              {formError && <p className="text-xs text-danger">{formError}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setDraft(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted hover:text-subtle">
                  {dict.common.cancel}
                </button>
                <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                  {pending ? dict.common.saving : dict.common.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl">
            <div className="mb-1 flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold">{detail.course.code} {detail.course.name}</h3>
                <p className="text-xs text-muted">
                  {formatDayTime(dict, locale, detail.dayOfWeek, detail.startTime, detail.endTime)} · {detail.room.name}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-faint hover:text-subtle">✕</button>
            </div>

            <div className="mt-4 flex flex-col gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted">{dict.schedule.notesLabel}</span>
              {isAdmin || detail.teacherId === currentUserId ? (
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={4}
                  placeholder={dict.schedule.notePlaceholder}
                  className="input w-full resize-none"
                />
              ) : (
                <p className="rounded-lg border border-line-soft px-3 py-2 text-sm text-subtle">
                  {detail.note || dict.schedule.noNotes}
                </p>
              )}
            </div>
            {noteError && <p className="mt-2 text-xs text-danger">{noteError}</p>}

            <div className="mt-4 flex items-center justify-between gap-2">
              {(isAdmin || detail.teacherId === currentUserId) ? (
                <button
                  onClick={() => onDelete(detail.id)}
                  disabled={pending}
                  className="text-xs font-semibold text-danger disabled:opacity-40"
                >
                  {dict.schedule.deleteThis}
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button type="button" onClick={() => setDetail(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted hover:text-subtle">
                  {dict.common.close}
                </button>
                {(isAdmin || detail.teacherId === currentUserId) && (
                  <button
                    onClick={onSaveNote}
                    disabled={pending}
                    className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {pending ? dict.common.saving : dict.common.save}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}
