import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { submitLessonPlan, reviewLessonPlan } from "@/actions/lessonPlans";
import LessonPlanUploadForm from "@/components/LessonPlanUploadForm";
import LessonPlanReviewRow from "@/components/LessonPlanReviewRow";

export default async function LessonPlansPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  if (session.user.role === "ADMIN") {
    const plans = await prisma.lessonPlan.findMany({
      include: { teacher: true, course: true },
      orderBy: { submittedAt: "desc" },
    });

    return (
      <div className="rounded-2xl border border-line bg-surface p-5">
        <h1 className="text-lg font-bold">แผนการสอนของอาจารย์ทั้งหมด</h1>
        <p className="mt-1 text-sm text-muted">ตรวจสอบและอนุมัติแผนการสอนที่อาจารย์ส่งเข้ามา</p>

        {plans.length === 0 ? (
          <p className="mt-6 text-sm text-faint">ยังไม่มีการส่งแผนการสอน</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-faint">
                  <th className="pb-2 font-semibold">อาจารย์</th>
                  <th className="pb-2 font-semibold">วิชา</th>
                  <th className="pb-2 font-semibold">ไฟล์</th>
                  <th className="pb-2 font-semibold">ส่งเมื่อ</th>
                  <th className="pb-2 font-semibold">สถานะ</th>
                  <th className="pb-2 font-semibold">การตรวจ</th>
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
                      teacher: { name: plan.teacher!.name },
                      course: { code: plan.course!.code, name: plan.course!.name },
                    }}
                    reviewLessonPlan={reviewLessonPlan}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // MEMBER: one upload slot per course the teacher actually teaches.
  const schedules = await prisma.schedule.findMany({
    where: { teacherId: session.user.id },
    include: { course: true },
    distinct: ["courseId"],
    orderBy: { course: { code: "asc" } },
  });

  const plans = await prisma.lessonPlan.findMany({ where: { teacherId: session.user.id } });
  const planByCourse = new Map(plans.map((p) => [p.courseId, p]));

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h1 className="text-lg font-bold">ส่งแผนการสอน</h1>
      <p className="mt-1 text-sm text-muted">ส่งไฟล์แผนการสอนของแต่ละวิชาที่คุณสอน ให้ Admin ตรวจสอบ</p>

      {schedules.length === 0 ? (
        <p className="mt-6 text-sm text-faint">คุณยังไม่มีตารางสอน จึงยังส่งแผนการสอนไม่ได้</p>
      ) : (
        <div className="mt-2">
          {schedules.map((s) => {
            const plan = planByCourse.get(s.courseId) ?? null;
            return (
              <LessonPlanUploadForm
                key={s.courseId}
                courseId={s.courseId}
                courseLabel={`${s.course!.code} ${s.course!.name}`}
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
                submitLessonPlan={submitLessonPlan}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
