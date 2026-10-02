"use client";

import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";

type Day = { key: string; label: string; need: number; done: number; holiday: string | null };

/** Date, school, week strip and "add a teacher by hand" for the substitute planner (state lives in the URL). */
export default function SubstituteControls({
  date,
  siteId,
  added,
  sites,
  week,
  teachers,
}: {
  date: string;
  siteId: string | null;
  added: string[];
  sites: { id: string; name: string; open: number }[];
  week: Day[];
  teachers: { id: string; name: string }[];
}) {
  const { dict } = useLanguage();
  const t = dict.substitutes;
  const b = t.board;
  const router = useRouter();
  const go = (d: string, site: string | null, ids: string[]) =>
    router.push(`/substitutes?date=${d}${site ? `&site=${site}` : ""}${ids.length ? `&add=${ids.join(",")}` : ""}`);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t.date}
          <input type="date" value={date} onChange={(e) => e.target.value && go(e.target.value, siteId, [])} className="input" />
        </label>
        {sites.length > 1 && (
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            {b.school}
            <select value={siteId ?? ""} onChange={(e) => go(date, e.target.value || null, added)} className="input max-w-full">
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.open ? ` · ${b.dayNeed(s.open)}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
          {t.addTeacher}
          <select value="" onChange={(e) => e.target.value && go(date, siteId, [...added, e.target.value])} className="input max-w-full">
            <option value="">{t.addTeacherPlaceholder}</option>
            {teachers.filter((x) => !added.includes(x.id)).map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        </label>
        {added.length > 0 && (
          <button type="button" onClick={() => go(date, siteId, [])} className="btn-ghost btn-sm">
            {t.clearAdded}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted">
        {b.week}
        <div className="flex flex-wrap gap-1.5">
          {week.map((d) => {
            const left = d.need - d.done;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => go(d.key, siteId, [])}
                aria-pressed={d.key === date}
                className={`flex min-w-[6.5rem] flex-col items-start rounded-xl border px-3 py-1.5 text-left ${d.key === date ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-line-soft"}`}
              >
                <span className="text-xs font-semibold text-ink">{d.label}</span>
                <span className={`text-[11px] font-semibold ${d.holiday ? "text-faint" : left > 0 ? "text-danger" : d.need ? "text-ok" : "text-faint"}`}>
                  {d.holiday ? b.dayHoliday : left > 0 ? b.dayNeed(left) : d.need ? b.dayDone(d.need) : b.dayNone}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
