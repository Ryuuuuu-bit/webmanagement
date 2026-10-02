import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import SubstituteControls from "@/components/SubstituteControls";
import TeacherGradeMatrix from "@/components/TeacherGradeMatrix";
import SubstituteSlot from "@/components/SubstituteSlot";
import { updateUserGradeLevels, assignSubstitute, cancelSubstitute } from "@/actions/substitutes";
import { buildSubstitutePlan, type AbsenceReason } from "@/lib/substitutes";
import { DATE_KEY_RE } from "@/lib/calendar";
import { bangkokDateKey, formatDate } from "@/lib/date";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

const REASON_TONE: Record<AbsenceReason, string> = {
  LEAVE: "bg-info-soft text-info",
  LEAVE_PENDING: "bg-warn-soft text-warn",
  ABSENT: "bg-danger-soft text-danger",
  NOT_CHECKED_IN: "bg-warn-soft text-warn",
  MANUAL: "bg-line-soft text-subtle",
  BOOKED: "bg-line-soft text-subtle",
};

/** "หาครูสอนแทน": who is out on a day, their classes, and who is free to cover each one. */
export default async function SubstitutesPage({ searchParams }: { searchParams: { date?: string; add?: string } }) {
  const session = await requireUser();
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  const locale = getLocale();
  const dict = getDictionary(locale);
  const t = dict.substitutes;

  const date = DATE_KEY_RE.test(searchParams.date ?? "") ? searchParams.date! : bangkokDateKey();
  const added = (searchParams.add ?? "").split(",").filter(Boolean).slice(0, 20);
  const plan = await buildSubstitutePlan(date, added);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold">{t.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.hint}</p>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <SubstituteControls date={date} added={added} teachers={plan.teachers.map((x) => ({ id: x.id, name: x.name }))} />
        <p className="mt-3 text-sm font-semibold">{formatDate(`${date}T00:00:00Z`, locale)}</p>
        {plan.holiday && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{t.holiday(plan.holiday)}</p>}
        {!plan.holiday && plan.weekend && <p className="mt-2 rounded-lg bg-line-soft px-3 py-2 text-sm text-subtle">{t.weekend}</p>}
        {plan.noSemester && <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{t.noSemester}</p>}
      </div>

      {plan.absent.length === 0 && <p className="rounded-2xl border border-line bg-surface p-5 text-sm text-faint shadow-sm">{t.nobodyOut}</p>}

      {plan.absent.map((a) => (
        <div key={a.id} className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold">{a.name}</h2>
            <span className={`badge ${REASON_TONE[a.reason]}`}>{t.reasons[a.reason]}{a.halfDay ? ` (${a.halfDay === "AM" ? t.halfAm : t.halfPm})` : ""}</span>
            {a.siteName && <span className="text-xs text-faint">📍 {a.siteName}</span>}
            {a.gradeLevels.length > 0 && <span className="text-xs text-faint">· {a.gradeLevels.map((g) => dict.grades[g]).join(", ")}</span>}
          </div>
          {a.dayOff ? (
            <p className="mt-2 text-sm text-faint">{t.dayOff}</p>
          ) : a.slots.length === 0 ? (
            <p className="mt-2 text-sm text-faint">{t.noClasses}</p>
          ) : null}
          <div className="mt-3 flex flex-col gap-3">
            {a.slots.map((s) => (
              <SubstituteSlot key={s.scheduleId} dateKey={date} slot={s} assign={assignSubstitute} cancel={cancelSubstitute} />
            ))}
          </div>
        </div>
      ))}

      <TeacherGradeMatrix teachers={plan.teachers} save={updateUserGradeLevels} />
    </div>
  );
}
