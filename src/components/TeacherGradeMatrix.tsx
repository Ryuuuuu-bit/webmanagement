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
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-faint">
              <th className="pb-2">{t.colTeacher}</th>
              {GRADES.map((g) => <th key={g} className="pb-2 text-center">{dict.grades[g]}</th>)}
            </tr>
          </thead>
          <tbody>
            {teachers.map((x) => (
              <tr key={x.id} className="border-t border-line-soft">
                <td className="py-1.5">
                  <div className="font-medium">{x.name}</div>
                  <div className="text-xs text-faint">{x.siteName ?? "—"}</div>
                </td>
                {GRADES.map((g) => (
                  <td key={g} className="py-1.5 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${x.name} ${dict.grades[g]}`}
                      checked={(levels[x.id] ?? []).includes(g)}
                      disabled={pending}
                      onChange={(e) => toggle(x.id, g, e.target.checked)}
                      className="h-4 w-4 accent-brand"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
