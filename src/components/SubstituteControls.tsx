"use client";

import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";

/** Day picker + "add a teacher by hand" for the substitute planner (state lives in the URL). */
export default function SubstituteControls({
  date,
  added,
  teachers,
}: {
  date: string;
  added: string[];
  teachers: { id: string; name: string }[];
}) {
  const { dict } = useLanguage();
  const t = dict.substitutes;
  const router = useRouter();
  const go = (d: string, ids: string[]) => router.push(`/substitutes?date=${d}${ids.length ? `&add=${ids.join(",")}` : ""}`);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t.date}
        <input type="date" value={date} onChange={(e) => e.target.value && go(e.target.value, [])} className="input" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t.addTeacher}
        <select value="" onChange={(e) => e.target.value && go(date, [...added, e.target.value])} className="input">
          <option value="">{t.addTeacherPlaceholder}</option>
          {teachers.filter((x) => !added.includes(x.id)).map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
      </label>
      {added.length > 0 && (
        <button type="button" onClick={() => go(date, [])} className="rounded-lg px-3 py-2 text-xs font-semibold text-muted hover:bg-line-soft">
          {t.clearAdded}
        </button>
      )}
    </div>
  );
}
