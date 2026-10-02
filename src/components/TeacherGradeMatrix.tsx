"use client";

import { useState, useTransition } from "react";
import { useLanguage } from "./LanguageProvider";
import TableFilter from "./TableFilter";

const GRADES = ["KG", "P1_3", "P4_6", "M1_3", "M4_6"] as const;

/** Teacher × grade-band checkboxes; each tick saves that teacher's row right away. */
export default function TeacherGradeMatrix({
  teachers,
  save,
}: {
  teachers: { id: string; name: string; siteName: string | null; gradeLevels: string[] }[];
  save: (userId: string, levels: string[]) => Promise<{ ok: boolean; message: string }>;
}) {
  const { dict } = useLanguage();
  const t = dict.substitutes;
  const [levels, setLevels] = useState<Record<string, string[]>>(() => Object.fromEntries(teachers.map((x) => [x.id, x.gradeLevels])));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(id: string, g: string, on: boolean) {
    const before = levels[id] ?? [];
    const next = on ? [...before, g] : before.filter((x) => x !== g);
    setLevels({ ...levels, [id]: next });
    startTransition(async () => {
      const res = await save(id, next);
      if (!res.ok) {
        setError(res.message);
        setLevels((cur) => ({ ...cur, [id]: before }));
      } else setError(null);
    });
  }

  const unset = teachers.filter((x) => (levels[x.id] ?? []).length === 0).length;

  return (
    <div id="grade-matrix" className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{t.gradesTitle}</h2>
      <p className="mt-1 text-sm text-muted">{t.gradesHint}</p>
      {unset > 0 && <p className="mt-1 text-xs text-warn">{t.gradesUnset(unset)}</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-3">
        <TableFilter targetId="grade-matrix" pageSize={30} />
      </div>
      {/* One row per teacher with five toggle chips — wraps on phones instead of a wide table. */}
      <ul className="divide-y divide-line-soft">
        {teachers.map((x) => (
          <li key={x.id} data-row className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{x.name}</div>
              <div className="truncate text-xs text-faint">{x.siteName ?? "—"}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {GRADES.map((g) => {
                const on = (levels[x.id] ?? []).includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${x.name} ${dict.grades[g]}`}
                    disabled={pending}
                    onClick={() => toggle(x.id, g, !on)}
                    className={`min-h-[2rem] rounded-full border px-3 text-xs transition-colors disabled:opacity-60 ${on ? "border-brand bg-brand text-white" : "border-line text-subtle hover:bg-line-soft"}`}
                  >
                    {dict.grades[g]}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
