import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AttendanceBadge } from "@/components/StatusBadge";
import CheckinClient from "@/components/CheckinClient";
import { formatTime, todayAtMidnight } from "@/lib/date";
import { getExpectedSite, type ExpectedSiteResult } from "@/lib/geo";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";

/** Renders one row of "your site today" — same three outcomes the check-in/out server actions themselves branch on (see getExpectedSite), so what a teacher sees here always matches what actually happens when they tap the button. */
function SiteRow({ label, result, dict }: { label: string; result: ExpectedSiteResult; dict: Dictionary }) {
  if (result.kind === "no_schedule") {
    return <p className="text-sm text-danger">{dict.actions.checkin.noScheduleToday}</p>;
  }
  if (result.kind === "no_location") {
    return <p className="text-sm text-danger">{dict.actions.checkin.roomNoLocation(result.room.name)}</p>;
  }
  return (
    <p className="text-sm">
      <span className="font-medium">{label}:</span>{" "}
      📍 {result.site.campusLocation.name}
      <span className="ml-1 text-faint">
        ({result.site.room.name}, {result.site.course.code})
      </span>
    </p>
  );
}

export default async function CheckinPage() {
  const session = await getServerSession(authOptions);
  const isAdmin = session!.user.role === "ADMIN";
  const date = todayAtMidnight();
  const locale = getLocale();
  const dict = getDictionary(locale);

  if (!isAdmin) {
    const [attendance, checkinSite, checkoutSite] = await Promise.all([
      prisma.attendance.findUnique({
        where: { userId_date: { userId: session!.user.id, date } },
      }),
      getExpectedSite(session!.user.id, "checkin"),
      getExpectedSite(session!.user.id, "checkout"),
    ]);

    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <div className="mb-4 flex justify-center">
            <AttendanceBadge status={attendance?.status ?? "PENDING"} dict={dict} />
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
          />
          <div className="mt-4 flex justify-center gap-6 text-sm text-subtle">
            <span>{dict.checkin.checkinShort}: {formatTime(attendance?.checkinAt, locale) ?? "—"}</span>
            <span>{dict.checkin.checkoutShort}: {formatTime(attendance?.checkoutAt, locale) ?? "—"}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{dict.checkin.todaySiteTitle}</h2>
          <p className="mb-3 text-sm text-muted">{dict.checkin.todaySiteHint}</p>
          <div className="flex flex-col gap-2">
            <SiteRow label={dict.checkin.checkinSiteLabel} result={checkinSite} dict={dict} />
            <SiteRow label={dict.checkin.checkoutSiteLabel} result={checkoutSite} dict={dict} />
          </div>
        </div>
      </div>
    );
  }

  const [teachers, attendances] = await Promise.all([
    prisma.user.findMany({ where: { role: "MEMBER" }, include: { department: true } }),
    prisma.attendance.findMany({ where: { date } }),
  ]);
  const byUser = new Map(attendances.map((a) => [a.userId, a]));

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{dict.checkin.overviewTitle}</h2>
      <p className="mb-3 text-sm text-muted">{dict.checkin.overviewHint}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-faint">
              <th className="pb-2">{dict.dashboard.admin.colTeacher}</th>
              <th className="pb-2">{dict.dashboard.admin.colStatus}</th>
              <th className="pb-2">{dict.checkin.colCheckin}</th>
              <th className="pb-2">{dict.checkin.colCheckout}</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => {
              const a = byUser.get(t.id);
              return (
                <tr key={t.id} className="border-t border-line-soft">
                  <td className="py-2">{t.name}</td>
                  <td className="py-2"><AttendanceBadge status={a?.status ?? "PENDING"} dict={dict} /></td>
                  <td className="py-2">
                    {formatTime(a?.checkinAt, locale) ?? "—"} {a?.attestedCheckin && <span className="text-[10px] text-warn">{dict.checkin.attested}</span>}
                  </td>
                  <td className="py-2">
                    {formatTime(a?.checkoutAt, locale) ?? "—"} {a?.attestedCheckout && <span className="text-[10px] text-warn">{dict.checkin.attested}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
