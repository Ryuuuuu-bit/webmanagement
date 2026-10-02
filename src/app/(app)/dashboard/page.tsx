import { requireUser } from "@/lib/session";
import { hasPendingCheckinAttestation } from "@/lib/attest";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { AttendanceBadge, attendanceDisplayStatus } from "@/components/StatusBadge";
import TableFilter from "@/components/TableFilter";
import CheckinClient, { type CredentialState } from "@/components/CheckinClient";
import { listMyCredentials } from "@/actions/webauthn";
import { getCheckinPolicy } from "@/lib/settings";
import { getAssignedSites } from "@/lib/geo";
import { bangkokDateKey, formatDate, formatTime, todayAtMidnight, toWeekdayIndex } from "@/lib/date";
import { holidayFor, isWorkday, loadWorkCalendar } from "@/lib/workdays";
import { keyToDate } from "@/lib/calendar";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";

export default async function DashboardPage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "ADMIN";
  const date = todayAtMidnight();
  const locale = getLocale();
  const dict = getDictionary(locale);
  const todayKey = bangkokDateKey();
  const cal = await loadWorkCalendar(todayKey, todayKey);

  if (!isAdmin) {
    const [attendance, todaySchedule, pendingLeave, pendingAttest, sites, credentials, policy] = await Promise.all([
      prisma.attendance.findUnique({ where: { userId_date: { userId: session.user.id, date } } }),
      prisma.schedule.findMany({
        where: { teacherId: session.user.id, dayOfWeek: toWeekdayIndex(new Date()) },
        include: { course: true, room: true },
        orderBy: { startTime: "asc" },
      }),
      prisma.leaveRequest.count({ where: { requesterId: session.user.id, status: "PENDING" } }),
      prisma.timeAttestation.count({ where: { requesterId: session.user.id, status: "PENDING" } }),
      getAssignedSites(session.user.id),
      listMyCredentials(),
      getCheckinPolicy(),
    ]);
    // Classes this teacher covers for absent colleagues, today and the next week.
    const duties = await prisma.substituteAssignment.findMany({
      where: { substituteId: session.user.id, date: { gte: keyToDate(todayKey), lte: new Date(+keyToDate(todayKey) + 7 * 86_400_000) } },
      orderBy: [{ date: "asc" }],
      select: { id: true, date: true, schedule: { select: { startTime: true, endTime: true, course: { select: { code: true, name: true } }, room: { select: { name: true } }, teacher: { select: { name: true } } } } },
    });
    const mySite = sites.primary?.id ?? null;
    const dayOff = !isWorkday(cal, todayKey, mySite);
    const holiday = holidayFor(cal, todayKey, mySite);
    // Same derivation as the check-in page, so the buttons behave identically here.
    const credentialState: CredentialState = credentials.some((c) => !c.pending)
      ? "approved"
      : credentials.length > 0
        ? "pending"
        : "none";
    const attestPending =
      !!attendance && !attendance.checkinAt && !!attendance.checkoutAt && (await hasPendingCheckinAttestation(session.user.id, date));

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
            attestPending={attestPending}
            sites={sites.all.map((x) => ({ name: x.name, latitude: x.latitude, longitude: x.longitude, radiusMeters: x.radiusMeters }))}
          />
          <p className="mt-3 text-center text-xs text-faint">
            {sites.all.length === 0 ? (
              <span className="text-danger">{dict.actions.checkin.noSiteAssigned}</span>
            ) : (
              <>📍 {sites.all.map((x) => x.name).join(" · ")}</>
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <StatTile label={d.statusToday} value={<AttendanceBadge status={attendance?.status ?? "PENDING"} row={attendance} dict={dict} dayOff={dayOff} />} />
          <StatTile label={d.checkinTime} value={formatTime(attendance?.checkinAt, locale) ?? "—"} />
          <StatTile label={d.checkoutTime} value={formatTime(attendance?.checkoutAt, locale) ?? "—"} />
          <StatTile label={d.pendingRequests} value={String(pendingLeave + pendingAttest)} />
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{d.todayScheduleTitle}</h2>
          <p className="mb-3 text-sm text-muted">{d.todayScheduleHint}</p>
          {dayOff ? (
            <p className="text-sm text-muted">{holiday ? d.holidayToday(holiday.title) : d.dayOffToday}</p>
          ) : todaySchedule.length === 0 ? (
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

        {duties.length > 0 && (
          <div className="rounded-2xl border border-brand bg-surface p-5 shadow-sm">
            <h2 className="text-base font-bold">{d.substituteTitle}</h2>
            <p className="mb-3 text-sm text-muted">{d.substituteHint}</p>
            <ul className="flex flex-col">
              {duties.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line-soft py-2 text-sm first:border-t-0">
                  <span className="font-semibold">{formatDate(x.date, locale)}</span>
                  <span className="font-mono">{x.schedule.startTime}–{x.schedule.endTime}</span>
                  <span>{x.schedule.course.code} {x.schedule.course.name}</span>
                  <span className="text-muted">{d.substituteRoom(x.schedule.room.name)}</span>
                  <span className="text-faint">{d.substituteFor(x.schedule.teacher.name)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const [teachers, attendances] = await Promise.all([
    prisma.user.findMany({ where: { role: "MEMBER", isActive: true }, include: { department: true }, orderBy: { name: "asc" } }),
    prisma.attendance.findMany({ where: { date } }),
  ]);
  const byUser = new Map(attendances.map((a) => [a.userId, a]));
  // Weekend / school-calendar holiday at a teacher's school: shown as
  // "วันหยุด" and left out of the "due today" count instead of "not in yet".
  const off = (siteId: string | null) => !isWorkday(cal, todayKey, siteId);
  const counts: Record<string, number> = {};
  for (const t of teachers) {
    const s = attendanceDisplayStatus(byUser.get(t.id)?.status ?? "PENDING", byUser.get(t.id), off(t.campusLocationId));
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const dueToday = teachers.length - (counts.HOLIDAY ?? 0);

  const d = dict.dashboard.admin;
  const deptOptions = Array.from(new Map(teachers.map((t) => [t.departmentId ?? "-", t.department?.name ?? "—"] as [string, string])).entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "th"));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label={counts.HOLIDAY ? d.dueTodayOff(counts.HOLIDAY) : d.totalTeachers} value={String(dueToday)} />
        <StatTile label={d.onTime} value={String(counts.ON_TIME ?? 0)} tone="ok" />
        <StatTile label={d.late} value={String(counts.LATE ?? 0)} tone="warn" />
        <StatTile label={d.notYet} value={String((counts.PENDING ?? 0) + (counts.AWAITING_ATTEST ?? 0))} />
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
                  <tr key={t.id} data-status={attendanceDisplayStatus(a?.status ?? "PENDING", a, off(t.campusLocationId))} data-dept={t.departmentId ?? "-"} className="border-t border-line-soft">
                    <td className="py-2">{t.name}</td>
                    <td className="py-2">{t.department?.name ?? "—"}</td>
                    <td className="py-2"><AttendanceBadge status={a?.status ?? "PENDING"} row={a} dict={dict} dayOff={off(t.campusLocationId)} /></td>
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
