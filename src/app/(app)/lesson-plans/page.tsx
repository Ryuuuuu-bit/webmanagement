import Link from "next/link";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { reviewLessonPlan } from "@/actions/lessonPlans";
import LessonPlanUploadForm from "@/components/LessonPlanUploadForm";
import LessonPlanReviewRow from "@/components/LessonPlanReviewRow";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";
import TableFilter from "@/components/TableFilter";
import { pickActiveSemester, daysUntilDue, isLate } from "@/lib/semesters";
import { lessonPlanSlots, isMissing } from "@/lib/lessonPlans";
import { formatDate } from "@/lib/date";

type Sem = { id: string; name: string; startDate: Date; endDate: Date; lessonPlanDueDate: Date | null };

/** Pills to switch semester (?semester=<id>); hidden when there's only one. */
function SemesterPicker({ semesters, currentId, dict }: { semesters: Sem[]; currentId: string; dict: Dictionary }) {
  if (semesters.length < 2) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-faint">{dict.lessonPlans.semesterLabel}</span>
      {semesters.map((s) => (
        <Link
          key={s.id}
          href={`/lesson-plans?semester=${s.id}`}
          className={`rounded-full border px-3 py-1 ${s.id === currentId ? "border-brand bg-brand-soft font-semibold text-brand-ink" : "border-line text-subtle hover:bg-line-soft"}`}
        >
          {s.name}
        </Link>
      ))}
    </div>
  );
}

/** "Due 15 Nov 2569 — 5 days left" / "due today" / "overdue by 2 days". */
function DueBanner({ sem, dict, locale, missing }: { sem: Sem; dict: Dictionary; locale: "th" | "en"; missing?: number }) {
  const t = dict.lessonPlans.due;
  if (!sem.lessonPlanDueDate) return <p className="mt-3 text-xs text-faint">{t.noDueDate(sem.name)}</p>;
  const left = daysUntilDue(sem.lessonPlanDueDate);
  const tone = left < 0 ? "border-danger bg-danger-soft text-danger" : left <= 7 ? "border-warn bg-warn-soft text-warn" : "border-line bg-page text-subtle";
  return (
    <div className={`mt-3 rounded-xl border px-4 py-2.5 text-sm ${tone}`}>
      <span className="font-semibold">{t.dueOn(sem.name, formatDate(sem.lessonPlanDueDate, locale))}</span>
      <span className="ml-2">{left > 0 ? t.daysLeft(left) : left === 0 ? t.dueToday : t.overdue(-left)}</span>
      {missing !== undefined && <span className="ml-2">· {missing > 0 ? t.missingCount(missing) : t.allIn}</span>}
    </div>
  );
}

export default async function LessonPlansPage({ searchParams }: { searchParams: { semester?: string } }) {
  const session = await requireUser();
  const locale = getLocale();
  const dict = getDictionary(locale);
  const allSemesters: Sem[] = await prisma.semester.findMany({
    select: { id: true, name: true, startDate: true, endDate: true, lessonPlanDueDate: true },
    orderBy: { startDate: "desc" },
  });

  if (session.user.role === "ADMIN") {
    const sem = allSemesters.find((s) => s.id === searchParams.semester) ?? pickActiveSemester(allSemesters);
    const [plans, slots] = sem
      ? await Promise.all([
          prisma.lessonPlan.findMany({
            // Plans uploaded before semesters were tracked (semesterId null) are shown with the active semester so nothing goes missing.
            where: sem.id === pickActiveSemester(allSemesters)?.id ? { OR: [{ semesterId: sem.id }, { semesterId: null }] } : { semesterId: sem.id },
            include: { teacher: true, course: true },
            orderBy: { submittedAt: "desc" },
          }),
          lessonPlanSlots(sem.id),
        ])
      : [[], []];
    const missing = slots.filter(isMissing);
    const missingByTeacher = new Map<string, { name: string; courses: string[] }>();
    for (const m of missing) {
      const e = missingByTeacher.get(m.teacherId) ?? { name: m.teacherName, courses: [] };
      e.courses.push(m.courseCode);
      missingByTeacher.set(m.teacherId, e);
    }
    const done = slots.length - missing.length;

    return (
      <div className="rounded-2xl border border-line bg-surface p-5">
        <h1 className="text-lg font-bold">{dict.lessonPlans.adminTitle}</h1>
        <p className="mt-1 text-sm text-muted">{dict.lessonPlans.adminHint}</p>
        {sem && <SemesterPicker semesters={allSemesters} currentId={sem.id} dict={dict} />}
        {sem && <DueBanner sem={sem} dict={dict} locale={locale} missing={missing.length} />}

        {sem && slots.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{dict.lessonPlans.progress(done, slots.length)}</span>
              <span>{Math.round((done / slots.length) * 100)}%</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-line-soft">
              <div className="h-full bg-brand" style={{ width: `${(done / slots.length) * 100}%` }} />
            </div>
            {missingByTeacher.size > 0 && (
              <details className="mt-3 rounded-xl border border-line px-4 py-2 text-sm">
                <summary className="cursor-pointer font-semibold">{dict.lessonPlans.missingTitle(missingByTeacher.size)}</summary>
                <ul className="mt-2 flex flex-col gap-1 text-xs">
                  {Array.from(missingByTeacher.entries()).map(([id, m]) => (
                    <li key={id} className="flex flex-wrap justify-between gap-2 border-t border-line-soft py-1 first:border-t-0">
                      <span>{m.name}</span>
                      <span className="text-faint">{m.courses.join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {!sem ? (
          <p className="mt-6 text-sm text-faint">{dict.lessonPlans.noSemesterYet}</p>
        ) : plans.length === 0 ? (
          <p className="mt-6 text-sm text-faint">{dict.lessonPlans.noneSubmitted}</p>
        ) : (
          <div id="lesson-plans-table" className="mt-4">
            <TableFilter targetId="lesson-plans-table" pageSize={50} selects={[{ attr: "status", label: dict.filter.status, options: Object.entries(dict.history.lessonStatus).map(([value, label]) => ({ value, label })) }]} />
            <div className="overflow-x-auto">
              <table className="table-stack w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-faint">
                    <th className="pb-2 font-semibold">{dict.lessonPlans.colTeacher}</th>
                    <th className="pb-2 font-semibold">{dict.lessonPlans.colCourse}</th>
                    <th className="pb-2 font-semibold">{dict.lessonPlans.colFile}</th>
                    <th className="pb-2 font-semibold">{dict.lessonPlans.colSubmittedAt}</th>
                    <th className="pb-2 font-semibold">{dict.lessonPlans.colStatus}</th>
                    <th className="pb-2 font-semibold">{dict.lessonPlans.colReview}</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <LessonPlanReviewRow
                      key={plan.id}
                      plan={{
                        id: plan.id,
                        fileName: plan.fileName,
                        status: plan.status,
                        reviewNote: plan.reviewNote,
                        submittedAt: plan.submittedAt.toISOString(),
                        late: isLate(plan.submittedAt, sem.lessonPlanDueDate),
                        teacher: { name: plan.teacher!.name },
                        course: { code: plan.course!.code, name: plan.course!.name },
                      }}
                      reviewLessonPlan={reviewLessonPlan}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // MEMBER: one upload slot per course the teacher teaches in the chosen semester.
  const mySemesterIds = new Set(
    (await prisma.schedule.findMany({ where: { teacherId: session.user.id }, distinct: ["semesterId"], select: { semesterId: true } })).map((x) => x.semesterId)
  );
  const mySemesters = allSemesters.filter((s) => mySemesterIds.has(s.id));
  const sem = mySemesters.find((s) => s.id === searchParams.semester) ?? pickActiveSemester(mySemesters);

  const schedules = sem
    ? await prisma.schedule.findMany({
        where: { teacherId: session.user.id, semesterId: sem.id },
        include: { course: true },
        distinct: ["courseId"],
        orderBy: { course: { code: "asc" } },
      })
    : [];
  const plans = sem ? await prisma.lessonPlan.findMany({ where: { teacherId: session.user.id, semesterId: sem.id } }) : [];
  const planByCourse = new Map(plans.map((p) => [p.courseId, p]));
  const missing = schedules.filter((s) => {
    const p = planByCourse.get(s.courseId);
    return !p || p.status === "NEEDS_REVISION";
  }).length;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h1 className="text-lg font-bold">{dict.lessonPlans.memberTitle}</h1>
      <p className="mt-1 text-sm text-muted">{dict.lessonPlans.memberHint}</p>
      {sem && <SemesterPicker semesters={mySemesters} currentId={sem.id} dict={dict} />}
      {sem && schedules.length > 0 && <DueBanner sem={sem} dict={dict} locale={locale} missing={missing} />}

      {!sem || schedules.length === 0 ? (
        <p className="mt-6 text-sm text-faint">{dict.lessonPlans.noSchedule}</p>
      ) : (
        <div className="mt-4">
          {schedules.map((s) => {
            const plan = planByCourse.get(s.courseId) ?? null;
            return (
              <LessonPlanUploadForm
                key={s.courseId}
                courseId={s.courseId}
                semesterId={sem.id}
                courseLabel={`${s.course!.code} ${s.course!.name}`}
                late={!!plan && isLate(plan.submittedAt, sem.lessonPlanDueDate)}
                plan={
                  plan
                    ? {
                        id: plan.id,
                        fileName: plan.fileName,
                        status: plan.status,
                        reviewNote: plan.reviewNote,
                        submittedAt: plan.submittedAt.toISOString(),
                      }
                    : null
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
