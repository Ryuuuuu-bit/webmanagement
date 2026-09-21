import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { AttendanceBadge } from "@/components/StatusBadge";
import TableFilter from "@/components/TableFilter";
import CheckinClient, { type CredentialState } from "@/components/CheckinClient";
import { listMyCredentials } from "@/actions/webauthn";
import { getCheckinPolicy } from "@/lib/settings";
import { getExpectedSite } from "@/lib/geo";
import { formatTime, todayAtMidnight, toWeekdayIndex } from "@/lib/date";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";

export default async function DashboardPage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "ADMIN";
  const date = todayAtMidnight();
  const locale = getLocale();
  const dict = getDictionary(locale);

  if (!isAdmin) {
    const [attendance, todaySchedule, pendingLeave, pendingAttest, site, credentials, policy] = await Promise.all([
      prisma.attendance.findUnique({ where: { userId_date: { userId: session.user.id, date } } }),
      prisma.schedule.findMany({
        where: { teacherId: session.user.id, dayOfWeek: toWeekdayIndex(new Date()) },
        include: { course: true, room: true },
        orderBy: { startTime: "asc" },
      }),
      prisma.leaveRequest.count({ where: { requesterId: session.user.id, status: "PENDING" } }),
      prisma.timeAttestation.count({ where: { requesterId: session.user.id, status: "PENDING" } }),
      getExpectedSite(session.user.id),
      listMyCredentials(),
      getCheckinPolicy(),
    ]);
    // Same derivation as the check-in page, so the buttons behave identically here.
    const credentialState: CredentialState = credentials.some((c) => !c.pending)
      ? "approved"
      : credentials.length > 0
        ? "pending"
        : "none";

    const d = dict.dashboard.member;

    return (
      <div className="flex flex-col gap-6">
        {/* Client request: check in/out straight from the dashboard — the
            same CheckinClient as /checkin (GPS → selfie → biometric), so
            every policy applies here too. Device management stays on /checkin. */}
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-6">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold">{d.checkinTitle}</h2>
              <p className="text-sm text-muted">{d.checkinHint}</p>
            </div>
            <Link href="/checkin" className="text-sm font-medium text-brand-ink hover:underline">
              {d.checkinMore}
            </Link>
          </div>
          <CheckinClient
            attendance={
              attendance
                ? {
                    status: attendance.status,
                    checkinAt: attendance.checkinAt?.toISOString() ?? null,
                    checkoutAt: attendance.checkoutAt?.toISOString() ?? null,
                  }
                : null
            }
            credentialState={credentialState}
            policy={policy}
          />
          <p className="mt-3 text-center text-xs text-faint">
            {site.kind === "no_site" ? (
              <span className="text-danger">{dict.actions.checkin.noSiteAssigned}</span>
            ) : (
              <>📍 {site.site.name}</>
            )}
          </p>
        </div>

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
              <table className="table-stack w-full min-w-0 text-sm">
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
  const deptOptions = Array.from(new Map(teachers.map((t) => [t.departmentId ?? "-", t.department?.name ?? "—"] as [string, string])).entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "th"));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-5">
        <StatTile label={d.totalTeachers} value={String(teachers.length)} />
        <StatTile label={d.onTime} value={String(counts.ON_TIME ?? 0)} tone="ok" />
        <StatTile label={d.late} value={String(counts.LATE ?? 0)} tone="warn" />
        <StatTile label={d.absent} value={String(counts.ABSENT ?? 0)} tone="danger" />
        <StatTile label={d.onLeave} value={String(counts.LEAVE ?? 0)} tone="info" />
      </div>

      <div id="dashboard-today" className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{d.statusTodayTitle}</h2>
        <p className="mb-3 text-sm text-muted">{d.statusTodayHint}</p>
        <TableFilter
          targetId="dashboard-today"
          pageSize={50}
          selects={[
            { attr: "status", label: dict.filter.status, options: Object.entries(dict.status.attendance).map(([value, label]) => ({ value, label })) },
            { attr: "dept", label: dict.filter.department, options: deptOptions },
          ]}
        />
        <div className="overflow-x-auto">
          <table className="table-stack w-full text-sm">
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
                  <tr key={t.id} data-status={a?.status ?? "PENDING"} data-dept={t.departmentId ?? "-"} className="border-t border-line-soft">
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
