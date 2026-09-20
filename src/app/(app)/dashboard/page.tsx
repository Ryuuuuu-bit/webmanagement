import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AttendanceBadge } from "@/components/StatusBadge";
import { formatTime, todayAtMidnight, toWeekdayIndex } from "@/lib/date";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const isAdmin = session!.user.role === "ADMIN";
  const date = todayAtMidnight();
  const locale = getLocale();
  const dict = getDictionary(locale);

  if (!isAdmin) {
    const [attendance, todaySchedule, pendingLeave, pendingAttest] = await Promise.all([
      prisma.attendance.findUnique({ where: { userId_date: { userId: session!.user.id, date } } }),
      prisma.schedule.findMany({
        where: { teacherId: session!.user.id, dayOfWeek: toWeekdayIndex(new Date()) },
        include: { course: true, room: true },
        orderBy: { startTime: "asc" },
      }),
      prisma.leaveRequest.count({ where: { requesterId: session!.user.id, status: "PENDING" } }),
      prisma.timeAttestation.count({ where: { requesterId: session!.user.id, status: "PENDING" } }),
    ]);

    const d = dict.dashboard.member;

    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <StatTile label={d.statusToday} value={<AttendanceBadge status={attendance?.status ?? "PENDING"} dict={dict} />} />
          <StatTile label={d.checkinTime} value={formatTime(attendance?.checkinAt, locale) ?? "—"} />
          <StatTile label={d.checkoutTime} value={formatTime(attendance?.checkoutAt, locale) ?? "—"} />
          <StatTile label={d.pendingRequests} value={String(pendingLeave + pendingAttest)} />
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{d.todayScheduleTitle}</h2>
          <p className="mb-3 text-sm text-muted">{d.todayScheduleHint}</p>
          {todaySchedule.length === 0 ? (
            <p className="text-sm text-muted">{d.noClassToday}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-0 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-faint">
                    <th className="pb-2">{d.colPeriod}</th>
                    <th className="pb-2">{d.colCourse}</th>
                    <th className="pb-2">{d.colRoom}</th>
                  </tr>
                </thead>
                <tbody>
                  {todaySchedule.map((s) => (
                    <tr key={s.id} className="border-t border-line-soft">
                      <td className="py-2">{s.startTime}–{s.endTime}</td>
                      <td className="py-2">{s.course!.code} {s.course!.name}</td>
                      <td className="py-2">{s.room!.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  const [teachers, attendances] = await Promise.all([
    prisma.user.findMany({ where: { role: "MEMBER", isActive: true }, include: { department: true } }),
    prisma.attendance.findMany({ where: { date } }),
  ]);
  const byUser = new Map(attendances.map((a) => [a.userId, a]));
  const counts: Record<string, number> = {};
  for (const t of teachers) {
    const s = byUser.get(t.id)?.status ?? "PENDING";
    counts[s] = (counts[s] ?? 0) + 1;
  }

  const d = dict.dashboard.admin;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-5">
        <StatTile label={d.totalTeachers} value={String(teachers.length)} />
        <StatTile label={d.onTime} value={String(counts.ON_TIME ?? 0)} tone="ok" />
        <StatTile label={d.late} value={String(counts.LATE ?? 0)} tone="warn" />
        <StatTile label={d.absent} value={String(counts.ABSENT ?? 0)} tone="danger" />
        <StatTile label={d.onLeave} value={String(counts.LEAVE ?? 0)} tone="info" />
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{d.statusTodayTitle}</h2>
        <p className="mb-3 text-sm text-muted">{d.statusTodayHint}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-faint">
                <th className="pb-2">{d.colTeacher}</th>
                <th className="pb-2">{d.colDepartment}</th>
                <th className="pb-2">{d.colStatus}</th>
                <th className="pb-2">{d.colCheckin}</th>
                <th className="pb-2">{d.colCheckout}</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => {
                const a = byUser.get(t.id);
                return (
                  <tr key={t.id} className="border-t border-line-soft">
                    <td className="py-2">{t.name}</td>
                    <td className="py-2">{t.department?.name ?? "—"}</td>
                    <td className="py-2"><AttendanceBadge status={a?.status ?? "PENDING"} dict={dict} /></td>
                    <td className="py-2">{formatTime(a?.checkinAt, locale) ?? "—"}</td>
                    <td className="py-2">{formatTime(a?.checkoutAt, locale) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "danger" | "info" }) {
  const toneCls = tone ? { ok: "text-ok", warn: "text-warn", danger: "text-danger", info: "text-info" }[tone] : "text-brand-ink";
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className={`text-xl font-semibold ${toneCls}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}
