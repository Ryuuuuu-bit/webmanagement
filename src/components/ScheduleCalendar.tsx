"use client";

import { useMemo, useState, useTransition } from "react";
import { DAY_LABELS } from "@/lib/date";

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
  course: { code: string; name: string };
  room: { name: string };
};
type ActionResult = { ok: boolean; message: string };

const GRID_START_HOUR = 7;
const GRID_END_HOUR = 19;
const HOUR_HEIGHT = 52; // px
const HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);

// A small fixed palette, colors picked by a hash of the course id so the
// same course always gets the same color across the whole calendar.
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

const DARK_INPUT = "w-full rounded-lg border border-white/15 bg-[#1f1f1f] px-2.5 py-1.5 text-white";

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
  deleteSchedule: (id: string) => Promise<ActionResult>;
}) {
  const [viewTeacherId, setViewTeacherId] = useState(selfTeacherId ?? teachers?.[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft>(null);
  const [formError, setFormError] = useState<string | null>(null);
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

  function onDelete(id: string) {
    if (!confirm("ลบตารางสอนนี้ใช่ไหม?")) return;
    startTransition(async () => {
      await deleteSchedule(id);
    });
  }

  return (
    <div className="rounded-2xl bg-[#1f1f1f] p-4 text-white shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {isAdmin ? (
          <select
            value={viewTeacherId}
            onChange={(e) => setViewTeacherId(e.target.value)}
            className="rounded-lg border border-white/15 bg-[#2b2b2b] px-3 py-1.5 text-sm text-white"
          >
            {teachers!.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        ) : (
          <div className="text-sm font-semibold text-white/70">ตารางสอนของฉัน</div>
        )}
        <button
          onClick={openBlankModal}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white"
        >
          + เพิ่มตารางสอน
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[820px] grid-cols-[56px_repeat(7,1fr)]">
          <div />
          {DAY_LABELS.map((d, i) => (
            <div key={d} className="pb-2 text-center">
              <div className={`text-lg font-semibold ${i === todayIndex ? "text-warn" : "text-white/90"}`}>
                {weekDayNumbers[i]}
              </div>
              <div className="text-[11px] text-white/40">{d}</div>
            </div>
          ))}

          <div className="relative" style={{ height: totalHeight }}>
            {HOURS.map((h) => (
              <div key={h} className="absolute left-0 right-0 -translate-y-2 text-right text-[10px] text-white/40" style={{ top: (h - GRID_START_HOUR) * HOUR_HEIGHT }}>
                {pad(h)}:00
              </div>
            ))}
          </div>

          {DAY_LABELS.map((_, dayIndex) => {
            const dayEvents = visible.filter((s) => s.dayOfWeek === dayIndex);
            return (
              <div key={dayIndex} className="relative border-l border-white/5" style={{ height: totalHeight }}>
                {HOURS.map((h, hi) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => openCellModal(dayIndex, h)}
                    className="absolute left-0 right-0 border-t border-white/5 transition-colors hover:bg-white/5"
                    style={{ top: hi * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                    aria-label={`เพิ่มตารางสอน ${DAY_LABELS[dayIndex]} ${pad(h)}:00`}
                  />
                ))}
                {dayEvents.map((s) => {
                  const top = Math.max(0, ((toMinutes(s.startTime) - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT);
                  const height = Math.max(20, ((toMinutes(s.endTime) - toMinutes(s.startTime)) / 60) * HOUR_HEIGHT);
                  const canDelete = isAdmin || s.teacherId === currentUserId;
                  return (
                    <div
                      key={s.id}
                      className="group absolute left-0.5 right-0.5 z-10 overflow-hidden rounded-md p-1.5 text-[11px] leading-tight shadow"
                      style={{ top, height, backgroundColor: colorFor(s.courseId) }}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="font-semibold">{s.course.code}</span>
                        {canDelete && (
                          <button
                            onClick={() => onDelete(s.id)}
                            disabled={pending}
                            className="hidden rounded bg-black/20 px-1 text-[10px] leading-none group-hover:block disabled:opacity-40"
                            aria-label="ลบ"
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <div className="text-white/85">{s.startTime}–{s.endTime}</div>
                      <div className="truncate text-white/70">{s.room.name}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#2b2b2b] p-5 text-white shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold">เพิ่มตารางสอน</h3>
              <button onClick={() => setDraft(null)} className="text-white/50 hover:text-white">✕</button>
            </div>
            <form onSubmit={onSubmit} className="flex flex-col gap-3 text-sm">
              {isAdmin ? (
                <Field label="อาจารย์">
                  <select value={viewTeacherId} onChange={(e) => setViewTeacherId(e.target.value)} className={DARK_INPUT}>
                    {teachers!.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
              ) : (
                <input type="hidden" name="teacherId" value={selfTeacherId} />
              )}
              <Field label="วิชา">
                <select name="courseId" required defaultValue="" className={DARK_INPUT}>
                  <option value="" disabled>เลือกวิชา</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
                </select>
              </Field>
              <Field label="ห้อง">
                <select name="roomId" required defaultValue="" className={DARK_INPUT}>
                  <option value="" disabled>เลือกห้อง</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
              <Field label="ภาคเรียน">
                <select name="semesterId" required defaultValue="" className={DARK_INPUT}>
                  <option value="" disabled>เลือกภาคเรียน</option>
                  {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="วัน">
                <select name="dayOfWeek" required defaultValue={draft.dayOfWeek} className={DARK_INPUT}>
                  {DAY_LABELS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="เริ่ม">
                  <input type="time" name="startTime" required defaultValue={draft.startTime} className={DARK_INPUT} />
                </Field>
                <Field label="สิ้นสุด">
                  <input type="time" name="endTime" required defaultValue={draft.endTime} className={DARK_INPUT} />
                </Field>
              </div>
              {formError && <p className="text-xs text-red-400">{formError}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setDraft(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white/60 hover:text-white">
                  ยกเลิก
                </button>
                <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                  {pending ? "กำลังบันทึก..." : "บันทึก"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-white/50">{label}</span>
      {children}
    </label>
  );
}
