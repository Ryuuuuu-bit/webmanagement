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
import { buildSubstitutePlan } from "@/lib/substitutes";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n/dictionaries";

/** "วันศุกร์ที่ 2 ตุลาคม 2569" / "Friday, October 2, 2026". */
function longDate(locale: Locale) {
  return new Date().toLocaleDateString(locale === "en" ? "en-US" : "th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
}

function greetingKey(): "morning" | "afternoon" | "evening" {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function Greeting({ name, dict, locale, children }: { name: string; dict: Dictionary; locale: Locale; children?: React.ReactNode }) {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-sm text-muted">{longDate(locale)}</p>
        <h1 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">{dict.dashboard.greeting[greetingKey()](first)}</h1>
      </div>
      {children}
    </div>
  );
}

export default async function DashboardPage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "ADMIN";
  const date = todayAtMidnight();
  const locale = getLocale();
  const dict = getDictionary(locale);
  const todayKey = bangkokDateKey();
  const cal = await loadWorkCalendar(todayKey, todayKey);
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } });
  const myName = me?.name ?? session.user.name ?? "";

  if (!isAdmin) {
    const [attendance, todaySchedule, pendingLeave, pendingAttest, sites, credentials, policy] = await Promise.all([
      prisma.attendance.findUnique({ where: { userId_date: { userId: session.user.id, date } } }),
      prisma.schedule.findMany({
        where: {
          teacherId: session.user.id,
          dayOfWeek: toWeekdayIndex(new Date()),
          semester: { startDate: { lte: keyToDate(todayKey) }, endDate: { gte: keyToDate(todayKey) } },
        },
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
    const nowHm = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });

    return (
      <div className="flex flex-col gap-5">
        <Greeting name={myName} dict={dict} locale={locale}>
          <AttendanceBadge status={attendance?.status ?? "PENDING"} row={attendance} dict={dict} dayOff={dayOff} />
        </Greeting>

        {/* Client request: check in/out straight from the dashboard — the
            same CheckinClient as /checkin (GPS → selfie → biometric), so
            every policy applies here too. Device management stays on /checkin. */}
        <section className="card p-4 sm:p-6">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-bold">{d.checkinTitle}</h2>
              <p className="truncate text-xs text-muted sm:text-sm">
                {sites.all.length === 0 ? <span className="text-danger">{dict.actions.checkin.noSiteAssigned}</span> : <>📍 {sites.all.map((x) => x.name).join(" · ")}</>}
              </p>
            </div>
            <Link href="/checkin" className="btn-ghost btn-sm flex-none">{d.checkinMore}</Link>
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
        </section>

        <div className="grid grid-cols-3 gap-3">
          <MiniStat label={d.checkinTime} value={formatTime(attendance?.checkinAt, locale) ?? "—"} />
          <MiniStat label={d.checkoutTime} value={formatTime(attendance?.checkoutAt, locale) ?? "—"} />
          <MiniStat label={d.pendingRequests} value={String(pendingLeave + pendingAttest)} href="/leave" />
        </div>

        {duties.length > 0 && (
          <section className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line bg-brand-soft px-4 py-3 sm:px-5">
              <span className="text-lg" aria-hidden="true">🔁</span>
              <div>
                <h2 className="text-sm font-bold text-brand-ink">{d.substituteTitle}</h2>
                <p className="text-xs text-muted">{d.substituteHint}</p>
              </div>
            </div>
            <ul className="divide-y divide-line-soft">
              {duties.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="w-16 flex-none text-center">
                    <div className="text-[11px] text-muted">{formatDate(x.date, locale)}</div>
                    <div className="font-mono text-sm font-semibold">{x.schedule.startTime}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{x.schedule.course.code} {x.schedule.course.name}</div>
                    <div className="truncate text-xs text-muted">{d.substituteRoom(x.schedule.room.name)} · {d.substituteFor(x.schedule.teacher.name)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 pt-4 sm:px-5">
            <h2 className="text-base font-bold">{d.todayScheduleTitle}</h2>
            <Link href="/schedule" className="text-xs font-medium text-brand-ink hover:underline">{d.fullSchedule}</Link>
          </div>
          {dayOff ? (
            <p className="px-4 py-6 text-center text-sm text-muted sm:px-5">🌴 {holiday ? d.holidayToday(holiday.title) : d.dayOffToday}</p>
          ) : todaySchedule.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted sm:px-5">{d.noClassToday}</p>
          ) : (
            <ol className="mt-2 px-4 pb-4 sm:px-5">
              {todaySchedule.map((s) => {
                const now = s.startTime <= nowHm && nowHm < s.endTime;
                const done = s.endTime <= nowHm;
                return (
                  <li key={s.id} className="flex gap-3 py-1.5">
                    <div className="w-12 flex-none pt-1 text-right font-mono text-xs leading-5 text-muted">
                      <div className={now ? "font-bold text-brand-ink" : ""}>{s.startTime}</div>
                      <div className="text-faint">{s.endTime}</div>
                    </div>
                    <div className={`min-w-0 flex-1 rounded-xl border-l-4 px-3 py-2 ${now ? "border-brand bg-brand-soft" : done ? "border-line-strong bg-page opacity-70" : "border-info bg-info-soft"}`}>
                      <div className="truncate text-sm font-semibold">{s.course!.code} · {s.course!.name}</div>
                      <div className="text-xs text-muted">{d.substituteRoom(s.room!.name)}{now ? ` · ${d.nowTeaching}` : ""}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    );
  }

  // ---------------------------------------------------------------- Admin
  const [teachers, attendances, pendingLeave, pendingAttest, pendingPlans, docsSoon, plan] = await Promise.all([
    prisma.user.findMany({ where: { role: "MEMBER", isActive: true }, include: { department: true, campusLocation: { select: { name: true } } }, orderBy: { name: "asc" } }),
    prisma.attendance.findMany({ where: { date } }),
    prisma.leaveRequest.count({ where: { status: "PENDING" } }),
    prisma.timeAttestation.count({ where: { status: "PENDING" } }),
    prisma.lessonPlan.count({ where: { status: "PENDING" } }),
    prisma.teacherDocument.count({ where: { expiryDate: { lte: new Date(+keyToDate(todayKey) + 60 * 86_400_000) }, user: { isActive: true } } }),
    buildSubstitutePlan(todayKey),
  ]);
  const uncovered = plan.absent.reduce((n, a) => n + a.slots.filter((s) => !s.booking || s.booking.unavailable).length, 0);
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
  const arrived = (counts.ON_TIME ?? 0) + (counts.LATE ?? 0);
  const notYet = (counts.PENDING ?? 0) + (counts.AWAITING_ATTEST ?? 0);
  const d = dict.dashboard.admin;
  const segments: { key: string; n: number; bar: string; label: string }[] = [
    { key: "ON_TIME", n: counts.ON_TIME ?? 0, bar: "bg-ok", label: d.onTime },
    { key: "LATE", n: counts.LATE ?? 0, bar: "bg-warn", label: d.late },
    { key: "LEAVE", n: counts.LEAVE ?? 0, bar: "bg-info", label: d.onLeave },
    { key: "ABSENT", n: counts.ABSENT ?? 0, bar: "bg-danger", label: d.absent },
    { key: "PENDING", n: notYet, bar: "bg-line-strong", label: d.notYet },
  ];
  const todo = [
    { n: pendingLeave, label: d.todoLeave, href: "/leave", icon: "📝" },
    { n: pendingAttest, label: d.todoAttest, href: "/attest", icon: "⏱️" },
    { n: uncovered, label: d.todoCover, href: "/substitutes", icon: "🔁" },
    { n: docsSoon, label: d.todoDocs, href: "/documents", icon: "🪪" },
    { n: pendingPlans, label: d.todoPlans, href: "/lesson-plans", icon: "📚" },
  ].filter((x) => x.n > 0);
  const deptOptions = Array.from(new Map(teachers.map((t) => [t.departmentId ?? "-", t.department?.name ?? "—"] as [string, string])).entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "th"));

  return (
    <div className="flex flex-col gap-5">
      <Greeting name={myName} dict={dict} locale={locale} />

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Today's attendance at a glance */}
        <section className="card p-4 sm:p-5 lg:col-span-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-muted">{d.overviewTitle}</h2>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="tabular text-4xl font-bold tracking-tight">{arrived}</span>
                <span className="tabular text-lg text-faint">/ {dueToday}</span>
                <span className="ml-1 text-sm text-muted">{d.arrived}</span>
              </div>
            </div>
            {dueToday > 0 && (
              <div className="text-right">
                <div className="tabular text-2xl font-bold text-brand-ink">{Math.round((arrived / dueToday) * 100)}%</div>
                <div className="text-[11px] text-faint">{d.rate}</div>
              </div>
            )}
          </div>
          <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-line-soft" role="img" aria-label={segments.map((s) => `${s.label} ${s.n}`).join(", ")}>
            {segments.filter((s) => s.n > 0).map((s) => (
              <div key={s.key} className={`${s.bar} h-full`} style={{ width: `${(s.n / Math.max(1, dueToday)) * 100}%` }} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {segments.map((s) => (
              <div key={s.key} className="rounded-xl bg-page px-2.5 py-2">
                <div className="flex items-center gap-1.5 text-[11px] text-muted">
                  <span className={`h-2 w-2 flex-none rounded-full ${s.bar}`} />
                  <span className="truncate">{s.label}</span>
                </div>
                <div className="tabular mt-0.5 text-lg font-bold">{s.n}</div>
              </div>
            ))}
            {(counts.HOLIDAY ?? 0) > 0 && (
              <div className="rounded-xl bg-page px-2.5 py-2">
                <div className="text-[11px] text-muted">{dict.status.attendance.HOLIDAY}</div>
                <div className="tabular mt-0.5 text-lg font-bold text-faint">{counts.HOLIDAY}</div>
              </div>
            )}
          </div>
        </section>

        {/* Things waiting for the Admin */}
        <section className="card flex flex-col p-4 sm:p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-muted">{d.todoTitle}</h2>
          {todo.length === 0 ? (
            <div className="flex min-h-[120px] flex-1 flex-col items-center justify-center gap-1 text-center">
              <span className="text-3xl" aria-hidden="true">✅</span>
              <p className="text-sm text-muted">{d.allClear}</p>
            </div>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {todo.map((x) => (
                <li key={x.href}>
                  <Link href={x.href} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-line-soft">
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-page text-base" aria-hidden="true">{x.icon}</span>
                    <span className="min-w-0 flex-1 text-sm">{x.label}</span>
                    <span className="badge tabular bg-danger-soft text-danger">{x.n}</span>
                    <span className="text-faint" aria-hidden="true">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section id="dashboard-today" className="card p-4 sm:p-5">
        <div className="mb-3">
          <h2 className="text-base font-bold">{d.statusTodayTitle}</h2>
          <p className="text-xs text-muted sm:text-sm">{d.statusTodayHint}</p>
        </div>
        <TableFilter
          targetId="dashboard-today"
          pageSize={50}
          selects={[
            { attr: "status", label: dict.filter.status, options: Object.entries(dict.status.attendance).map(([value, label]) => ({ value, label })) },
            { attr: "dept", label: dict.filter.department, options: deptOptions },
          ]}
        />
        {/* Compact rows on every screen size: avatar · name / department · times · status. */}
        <ul className="divide-y divide-line-soft">
          {teachers.map((t) => {
            const a = byUser.get(t.id);
            const dayOff = off(t.campusLocationId);
            return (
              <li
                key={t.id}
                data-row
                data-status={attendanceDisplayStatus(a?.status ?? "PENDING", a, dayOff)}
                data-dept={t.departmentId ?? "-"}
                className="flex items-center gap-3 py-2.5"
              >
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-ink">
                  {t.name.trim().charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{t.name}</div>
                  <div className="truncate text-xs text-muted">
                    {t.department?.name ?? "—"}
                    {t.campusLocation ? ` · ${t.campusLocation.name}` : ""}
                  </div>
                </div>
                <div className="tabular hidden w-28 flex-none text-right font-mono text-xs text-muted sm:block">
                  {a?.checkinAt || a?.checkoutAt ? `${formatTime(a?.checkinAt, locale) ?? "—"} → ${formatTime(a?.checkoutAt, locale) ?? "—"}` : ""}
                </div>
                <div className="flex flex-none flex-col items-end gap-0.5">
                  <AttendanceBadge status={a?.status ?? "PENDING"} row={a} dict={dict} dayOff={dayOff} />
                  {a?.checkinAt && <span className="font-mono text-[11px] text-faint sm:hidden">{formatTime(a.checkinAt, locale)}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function MiniStat({ label, value, href }: { label: string; value: React.ReactNode; href?: string }) {
  const inner = (
    <>
      <div className="tabular text-lg font-bold sm:text-xl">{value}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-muted sm:text-xs">{label}</div>
    </>
  );
  return href ? (
    <Link href={href} className="card block px-3 py-3 hover:border-brand sm:px-4">{inner}</Link>
  ) : (
    <div className="card px-3 py-3 sm:px-4">{inner}</div>
  );
}
