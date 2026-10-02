import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import SubstituteControls from "@/components/SubstituteControls";
import SubstitutePlanner from "@/components/SubstitutePlanner";
import TeacherGradeMatrix from "@/components/TeacherGradeMatrix";
import { updateUserGradeLevels, assignSubstitute, cancelSubstitute } from "@/actions/substitutes";
import { buildSubstituteBoard, substituteWeek } from "@/lib/substitutes";
import { DATE_KEY_RE } from "@/lib/calendar";
import { bangkokDateKey, formatDate } from "@/lib/date";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * "หาครูสอนแทน": one school's day — who is out, the classes that need cover,
 * a teacher × class-time grid of who is free, and a panel to book a
 * substitute for the picked class (SubstitutePlanner).
 */
export default async function SubstitutesPage({ searchParams }: { searchParams: { date?: string; add?: string; site?: string } }) {
  const session = await requireUser();
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  const locale = getLocale();
  const dict = getDictionary(locale);
  const t = dict.substitutes;

  const date = DATE_KEY_RE.test(searchParams.date ?? "") ? searchParams.date! : bangkokDateKey();
  const added = (searchParams.add ?? "").split(",").filter(Boolean).slice(0, 20);
  const board = await buildSubstituteBoard(date, searchParams.site || null, added);
  // Day labels are formatted here (server) so the client renders the same text it hydrates.
  const week = (await substituteWeek(date, board.siteId)).map((d) => ({
    ...d,
    label: new Date(`${d.key}T00:00:00Z`).toLocaleDateString(locale === "th" ? "th-TH" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold">{t.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.board.emptySteps[0]} · {t.board.rankRule}</p>
      </div>

      <div className="card flex flex-col gap-3 p-4">
        <SubstituteControls
          date={date}
          siteId={board.siteId}
          added={added}
          sites={board.sites}
          week={week}
          teachers={board.teachers.map((x) => ({ id: x.id, name: x.name }))}
        />
        <p className="text-sm font-semibold">{formatDate(`${date}T00:00:00Z`, locale)}</p>
        {board.holiday && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{t.holiday(board.holiday)}</p>}
        {!board.holiday && board.weekend && <p className="rounded-lg bg-line-soft px-3 py-2 text-sm text-subtle">{t.weekend}</p>}
        {board.noSemester && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{t.noSemester}</p>}
        {date < bangkokDateKey() && <p className="text-xs text-faint">{t.board.past}</p>}
      </div>

      <SubstitutePlanner
        dateKey={date}
        isToday={board.isToday}
        out={board.out}
        waiting={board.waiting}
        slots={board.slots}
        columns={board.columns}
        rows={board.rows}
        assign={assignSubstitute}
        cancel={cancelSubstitute}
      />

      <details className="card p-0 [&_#grade-matrix]:border-0 [&_#grade-matrix]:shadow-none">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">{t.board.gradesToggle}</summary>
        <TeacherGradeMatrix teachers={board.teachers} save={updateUserGradeLevels} />
      </details>
    </div>
  );
}
