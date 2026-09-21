"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { formatDayTime } from "@/lib/date";
import { useLanguage } from "./LanguageProvider";

type Option = { id: string; name?: string; code?: string; building?: string; campusLocationId?: string | null; siteName?: string | null; groupName?: string | null };
type SemesterOption = { id: string; name: string; startDate: string; endDate: string };
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
type View = "week" | "workWeek" | "day";

// The grid spans 06:00–22:00 like a real calendar app (Teams shows the full
// day) — anything outside that is unlikely for a class, and the grid
// auto-scrolls to the current time so the visible part is always relevant.
const GRID_START_HOUR = 6;
const GRID_END_HOUR = 22;
const HOUR_HEIGHT = 56; // px
const HOURS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);
const GUTTER_WIDTH = 64; // px

// A small fixed palette, colors picked by a hash of the course id so the
// same course always gets the same color across the whole calendar. These
// stay fixed regardless of light/dark theme — they're identity tags, not
// surface colors. Events render Teams-style: a tinted background with a
// solid accent bar on the left, text in the theme's ink color.
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

// ---- date helpers (browser-local, like any calendar app) ----

/** JS getDay() (0=Sun..6=Sat) → app's 0=Mon..6=Sun. */
function weekdayIndex(d: Date) {
  return (d.getDay() + 6) % 7;
}

function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function mondayOf(d: Date) {
  return addDays(startOfDay(d), -weekdayIndex(d));
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function intlLocale(locale: string) {
  return locale === "en" ? "en-US" : "th-TH";
}

type Draft = { dayOfWeek: number; startTime: string; endTime: string; semesterId: string } | null;

export default function ScheduleCalendar({
  schedules,
  teachers,
  selfTeacherId,
  courses,
  rooms,
  semesters,
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
  semesters: SemesterOption[];
  currentUserId: string;
  isAdmin: boolean;
  createSchedule: (formData: FormData) => Promise<ActionResult>;
  updateScheduleNote: (id: string, note: string) => Promise<ActionResult>;
  deleteSchedule: (id: string) => Promise<ActionResult>;
}) {
  const { dict, locale } = useLanguage();
  const intl = intlLocale(locale);

  const [viewTeacherId, setViewTeacherId] = useState(selfTeacherId ?? teachers?.[0]?.id ?? "");
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [now, setNow] = useState<Date>(() => new Date());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [pickerMonth, setPickerMonth] = useState<Date>(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [hoverSlot, setHoverSlot] = useState<{ day: number; hour: number } | null>(null);

  const [draft, setDraft] = useState<Draft>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ScheduleRow | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const scrollRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  // Phones default to the Day view — a 7-column week is unreadable there
  // (Teams does the same on mobile).
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches) setView("day");
  }, []);

  // Keep the "now" line moving once a minute.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Scroll the grid so the current time (or 08:00 if now is outside the
  // grid) sits near the top on first render, like Teams.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hour = now.getHours() >= GRID_START_HOUR && now.getHours() < GRID_END_HOUR ? now.getHours() : 8;
    el.scrollTop = Math.max(0, (hour - GRID_START_HOUR - 1) * HOUR_HEIGHT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close popovers on outside click / Escape.
  useEffect(() => {
    if (!pickerOpen && !viewMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) setViewMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPickerOpen(false);
        setViewMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen, viewMenuOpen]);

  // ---- visible date range ----
  const days: Date[] = useMemo(() => {
    if (view === "day") return [anchor];
    const mon = mondayOf(anchor);
    return Array.from({ length: view === "workWeek" ? 5 : 7 }, (_, i) => addDays(mon, i));
  }, [view, anchor]);

  const today = startOfDay(now);
  const todayInRange = days.some((d) => sameDay(d, today));

  // Semester coverage per visible day: a class only shows on dates inside
  // its semester's start–end range (client decision — navigating to a week
  // outside any semester shows an empty calendar rather than repeating
  // the timetable forever).
  const semesterRanges = useMemo(
    () =>
      semesters.map((s) => {
        const end = new Date(s.endDate);
        end.setHours(23, 59, 59, 999);
        return { id: s.id, name: s.name, start: startOfDay(new Date(s.startDate)), end };
      }),
    [semesters]
  );

  function semestersCovering(d: Date) {
    return semesterRanges.filter((s) => d >= s.start && d <= s.end).map((s) => s.id);
  }

  const teacherSchedules = useMemo(
    () => schedules.filter((s) => s.teacherId === (isAdmin ? viewTeacherId : selfTeacherId)),
    [schedules, viewTeacherId, isAdmin, selfTeacherId]
  );

  const eventsByDay = useMemo(
    () =>
      days.map((d) => {
        const covering = new Set(semestersCovering(d));
        const dow = weekdayIndex(d);
        return teacherSchedules.filter((s) => s.dayOfWeek === dow && covering.has(s.semesterId));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, teacherSchedules, semesterRanges]
  );

  const anySemesterInRange = days.some((d) => semestersCovering(d).length > 0);

  // ---- toolbar labels ----
  const rangeLabel = useMemo(() => {
    const first = days[0];
    const last = days[days.length - 1];
    if (view === "day") return first.toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric" });
    if (first.getMonth() === last.getMonth()) return first.toLocaleDateString(intl, { month: "long", year: "numeric" });
    return `${first.toLocaleDateString(intl, { month: "short" })} – ${last.toLocaleDateString(intl, { month: "short", year: "numeric" })}`;
  }, [days, view, intl]);

  function hourLabel(h: number) {
    if (locale === "en") {
      const suffix = h < 12 ? "AM" : "PM";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${h12} ${suffix}`;
    }
    return `${pad(h)}:00`;
  }

  function step(dir: -1 | 1) {
    setAnchor((a) => addDays(a, view === "day" ? dir : 7 * dir));
  }

  function goToday() {
    setAnchor(today);
    setPickerMonth(new Date(today.getFullYear(), today.getMonth(), 1));
  }

  function openPicker() {
    setPickerMonth(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    setPickerOpen((o) => !o);
  }

  // ---- modals ----
  function openBlankModal() {
    setFormError(null);
    const d = todayInRange ? today : days[0];
    setDraft({ dayOfWeek: weekdayIndex(d), startTime: "08:30", endTime: "09:30", semesterId: semestersCovering(d)[0] ?? "" });
  }

  function openCellModal(dayIdx: number, hour: number) {
    setFormError(null);
    const d = days[dayIdx];
    setDraft({ dayOfWeek: weekdayIndex(d), startTime: `${pad(hour)}:00`, endTime: `${pad(hour + 1)}:00`, semesterId: semestersCovering(d)[0] ?? "" });
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
      if (res.ok) setDetail(null);
      else setNoteError(res.message);
    });
  }

  function onDelete(id: string) {
    if (!confirm(dict.schedule.deleteConfirm)) return;
    startTransition(async () => {
      await deleteSchedule(id);
      setDetail(null);
    });
  }

  // ---- mini calendar (date picker popover) ----
  const pickerCells = useMemo(() => {
    const first = new Date(pickerMonth.getFullYear(), pickerMonth.getMonth(), 1);
    const gridStart = mondayOf(first);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [pickerMonth]);

  const selectedWeekStart = mondayOf(anchor);
  const selectedWeekEnd = addDays(selectedWeekStart, view === "workWeek" ? 4 : 6);

  const totalHeight = HOURS.length * HOUR_HEIGHT;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMinutes - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT;
  const showNowLine = todayInRange && nowTop >= 0 && nowTop <= totalHeight;
  const viewLabels: Record<View, string> = { week: dict.calendar.week, workWeek: dict.calendar.workWeek, day: dict.calendar.day };

  const toolbarBtn = "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-subtle transition-colors hover:bg-line-soft hover:text-ink";

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      {/* ---------- Toolbar (Teams-style) ---------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" onClick={goToday} className={toolbarBtn} title={dict.calendar.today}>
          <CalendarIcon />
          <span>{dict.calendar.today}</span>
        </button>
        <div className="flex items-center">
          <button type="button" onClick={() => step(-1)} className={`${toolbarBtn} px-1.5`} aria-label={dict.calendar.prev}>
            <ChevronIcon dir="left" />
          </button>
          <button type="button" onClick={() => step(1)} className={`${toolbarBtn} px-1.5`} aria-label={dict.calendar.next}>
            <ChevronIcon dir="right" />
          </button>
        </div>

        <div className="relative" ref={pickerRef}>
          <button type="button" onClick={openPicker} className={`${toolbarBtn} font-semibold text-ink`} aria-expanded={pickerOpen}>
            <span>{rangeLabel}</span>
            <ChevronIcon dir="down" />
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-40 mt-1 w-[272px] rounded-xl border border-line bg-surface p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {pickerMonth.toLocaleDateString(intl, { month: "long", year: "numeric" })}
                </span>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setPickerMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                    className="rounded-md p-1 text-subtle hover:bg-line-soft"
                    aria-label={dict.calendar.prevMonth}
                  >
                    <ChevronIcon dir="left" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickerMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                    className="rounded-md p-1 text-subtle hover:bg-line-soft"
                    aria-label={dict.calendar.nextMonth}
                  >
                    <ChevronIcon dir="right" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-faint">
                {dict.day.mini.map((d, i) => (
                  <div key={i} className="py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {pickerCells.map((d) => {
                  const inMonth = d.getMonth() === pickerMonth.getMonth();
                  const isToday = sameDay(d, today);
                  const inSelectedWeek = view !== "day" && d >= selectedWeekStart && d <= selectedWeekEnd;
                  const isSelected = sameDay(d, anchor);
                  const rowStart = inSelectedWeek && sameDay(d, selectedWeekStart);
                  const rowEnd = inSelectedWeek && sameDay(d, selectedWeekEnd);
                  return (
                    <button
                      key={d.toISOString()}
                      type="button"
                      onClick={() => {
                        setAnchor(d);
                        setPickerOpen(false);
                      }}
                      className={[
                        "relative flex h-8 items-center justify-center text-xs transition-colors",
                        inSelectedWeek ? "bg-brand-soft" : "hover:bg-line-soft",
                        rowStart ? "rounded-l-md" : "",
                        rowEnd ? "rounded-r-md" : "",
                        inMonth ? "text-ink" : "text-faint",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex h-6 w-6 items-center justify-center rounded-full",
                          isSelected ? "bg-brand font-semibold text-white" : isToday ? "font-bold text-brand" : "",
                        ].join(" ")}
                      >
                        {d.getDate()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {!anySemesterInRange && (
          <span className="hidden text-xs text-faint sm:inline">{dict.calendar.noSemesterInRange}</span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {isAdmin && (
            // 100 instructors: grouped by department so the list is scannable; full width on phones.
            <select value={viewTeacherId} onChange={(e) => setViewTeacherId(e.target.value)} className="input w-full truncate py-1.5 text-sm sm:w-auto sm:max-w-[240px]">
              <TeacherOptions teachers={teachers!} />
            </select>
          )}

          <div className="relative" ref={viewMenuRef}>
            <button type="button" onClick={() => setViewMenuOpen((o) => !o)} className={toolbarBtn} aria-expanded={viewMenuOpen}>
              <GridIcon />
              <span>{viewLabels[view]}</span>
              <ChevronIcon dir="down" />
            </button>
            {viewMenuOpen && (
              <div className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl">
                {(["day", "workWeek", "week"] as View[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setView(v);
                      setViewMenuOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-line-soft ${v === view ? "font-semibold text-brand" : "text-ink"}`}
                  >
                    {viewLabels[v]}
                    {v === view && <CheckIcon />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={openBlankModal} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-semibold text-white hover:opacity-90">
            <PlusIcon />
            <span className="hidden sm:inline">{dict.schedule.addButton.replace(/^\+\s*/, "")}</span>
            <span className="sm:hidden">{dict.common.add}</span>
          </button>
        </div>
      </div>

      {/* ---------- Grid ---------- */}
      <div ref={scrollRef} className="relative max-h-[calc(100vh-220px)] min-h-[420px] overflow-auto">
        <div className={view === "day" ? "" : "min-w-[720px]"}>
          {/* Day headers (sticky) */}
          <div
            className="sticky top-0 z-20 grid border-b border-line bg-surface"
            style={{ gridTemplateColumns: `${GUTTER_WIDTH}px repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <div />
            {days.map((d, i) => {
              const isToday = sameDay(d, today);
              return (
                <div
                  key={i}
                  className={`border-l border-line-soft px-2 pb-2 pt-1.5 ${isToday ? "border-t-2 border-t-brand" : "border-t-2 border-t-transparent"}`}
                >
                  <div className={`text-2xl font-semibold leading-tight ${isToday ? "text-brand" : "text-ink"}`}>{d.getDate()}</div>
                  <div className={`text-xs ${isToday ? "font-semibold text-brand" : "text-faint"}`}>
                    {view === "day" ? dict.day.full[weekdayIndex(d)] : dict.day.short[weekdayIndex(d)]}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Body */}
          <div
            className="relative grid"
            style={{ gridTemplateColumns: `${GUTTER_WIDTH}px repeat(${days.length}, minmax(0, 1fr))`, height: totalHeight }}
          >
            {/* time gutter */}
            <div className="relative select-none">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-[11px] text-faint"
                  style={{ top: (h - GRID_START_HOUR) * HOUR_HEIGHT }}
                >
                  {h === GRID_START_HOUR ? "" : hourLabel(h)}
                </div>
              ))}
              {showNowLine && (
                <div
                  className="absolute right-1 z-[15] -translate-y-1/2 rounded bg-danger px-1 text-[10px] font-semibold leading-4 text-white"
                  style={{ top: nowTop }}
                >
                  {pad(now.getHours())}:{pad(now.getMinutes())}
                </div>
              )}
            </div>

            {/* day columns */}
            {days.map((d, dayIdx) => {
              const isToday = sameDay(d, today);
              const dayEvents = eventsByDay[dayIdx];
              return (
                <div
                  key={dayIdx}
                  className="relative border-l border-line-soft"
                  style={isToday ? { backgroundColor: "color-mix(in srgb, var(--color-brand) 5%, transparent)" } : undefined}
                >
                  {HOURS.map((h, hi) => {
                    const hovered = hoverSlot?.day === dayIdx && hoverSlot.hour === h;
                    return (
                      <button
                        key={h}
                        type="button"
                        onClick={() => openCellModal(dayIdx, h)}
                        onMouseEnter={() => setHoverSlot({ day: dayIdx, hour: h })}
                        onMouseLeave={() => setHoverSlot(null)}
                        className={`absolute left-0 right-0 border-t border-line-soft ${hovered ? "z-[5] bg-line-soft ring-1 ring-inset ring-line-strong" : ""}`}
                        style={{ top: hi * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                        aria-label={dict.schedule.addAriaLabel(formatDayTime(dict, locale, weekdayIndex(d), `${pad(h)}:00`))}
                      >
                        {/* half-hour dashed guide */}
                        <span className="pointer-events-none absolute left-0 right-0 top-1/2 border-t border-dashed border-line-soft" />
                        {hovered && (
                          <span className="pointer-events-none absolute left-1.5 top-1 text-[10px] font-medium text-faint">
                            {hourLabel(h)}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {dayEvents.map((s) => {
                    const top = Math.max(0, ((toMinutes(s.startTime) - GRID_START_HOUR * 60) / 60) * HOUR_HEIGHT);
                    const height = Math.max(22, ((toMinutes(s.endTime) - toMinutes(s.startTime)) / 60) * HOUR_HEIGHT - 2);
                    const color = colorFor(s.courseId);
                    const canManage = isAdmin || s.teacherId === currentUserId;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => openDetail(s)}
                        className="absolute left-1 right-1 z-10 flex flex-col items-stretch overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left text-[11px] leading-tight text-ink shadow-sm transition-shadow hover:shadow-md"
                        style={{ top: top + 1, height, backgroundColor: `${color}2E`, borderLeftColor: color }}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="truncate font-semibold">{s.course.code} {s.course.name}</span>
                          {s.note && <span className="text-[9px] leading-none opacity-80" title={dict.schedule.hasNoteTitle}>📝</span>}
                        </div>
                        <div className="text-subtle">{s.startTime}–{s.endTime} · {s.room.name}</div>
                        {canManage && <span className="sr-only">{dict.schedule.editableHint}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {/* current time line across all visible days */}
            {showNowLine && (
              <div className="pointer-events-none absolute right-0 z-[15] border-t-2 border-danger" style={{ top: nowTop, left: GUTTER_WIDTH }}>
                <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-danger" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------- Add modal ---------- */}
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
                    <TeacherOptions teachers={teachers!} />
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
                {(() => {
                  // Only rooms at this teacher's own site (plus rooms with no
                  // site yet) — a class at another branch can't be attended,
                  // and check-in there would fail anyway.
                  const teacherSite = (isAdmin ? teachers?.find((t) => t.id === viewTeacherId) : teachers?.find((t) => t.id === selfTeacherId))?.campusLocationId ?? null;
                  const visible = teacherSite ? rooms.filter((r) => !r.campusLocationId || r.campusLocationId === teacherSite) : rooms;
                  const hidden = rooms.length - visible.length;
                  return (
                    <>
                      <select name="roomId" required defaultValue="" className="input w-full">
                        <option value="" disabled>{dict.schedule.selectRoom}</option>
                        {visible.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}{r.building ? ` (${r.building})` : ""}{r.siteName ? ` · ${r.siteName}` : ""}
                          </option>
                        ))}
                      </select>
                      {hidden > 0 && <p className="mt-1 text-[11px] text-faint">{dict.schedule.roomsFilteredHint(hidden)}</p>}
                      {visible.length === 0 && <p className="mt-1 text-[11px] text-danger">{dict.schedule.noRoomsAtSite}</p>}
                    </>
                  );
                })()}
              </Field>
              <Field label={dict.schedule.fieldSemester}>
                <select name="semesterId" required defaultValue={draft.semesterId} className="input w-full">
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

      {/* ---------- Detail modal ---------- */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl">
            <div className="mb-1 flex items-start justify-between">
              <div className="flex items-start gap-2">
                <span className="mt-1 h-4 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: colorFor(detail.courseId) }} />
                <div>
                  <h3 className="text-base font-bold">{detail.course.code} {detail.course.name}</h3>
                  <p className="text-xs text-muted">
                    {formatDayTime(dict, locale, detail.dayOfWeek, detail.startTime, detail.endTime)} · {detail.room.name}
                  </p>
                  <p className="text-xs text-faint">{semesters.find((s) => s.id === detail.semesterId)?.name}</p>
                </div>
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
                <button onClick={() => onDelete(detail.id)} disabled={pending} className="text-xs font-semibold text-danger disabled:opacity-40">
                  {dict.schedule.deleteThis}
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button type="button" onClick={() => setDetail(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted hover:text-subtle">
                  {dict.common.close}
                </button>
                {(isAdmin || detail.teacherId === currentUserId) && (
                  <button onClick={onSaveNote} disabled={pending} className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
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

// ---- tiny inline icons (no icon library dependency) ----

function ChevronIcon({ dir }: { dir: "left" | "right" | "down" }) {
  const rotate = dir === "left" ? "rotate-90" : dir === "right" ? "-rotate-90" : "";
  return (
    <svg className={`h-3.5 w-3.5 ${rotate}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M6 2v12M10 2v12M2 6h12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

/** <option>s grouped by department (optgroup) when the list has one; plain list otherwise. */
function TeacherOptions({ teachers }: { teachers: Option[] }) {
  const groups = new Map<string, Option[]>();
  for (const t of teachers) {
    const g = t.groupName ?? "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }
  if (groups.size <= 1) return <>{teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</>;
  const keys = Array.from(groups.keys()).sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "th")));
  return (
    <>
      {keys.map((g) => (
        <optgroup key={g || "-"} label={g || "—"}>
          {groups.get(g)!.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </optgroup>
      ))}
    </>
  );
}
