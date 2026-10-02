import { requireUser } from "@/lib/session";
import { hasPendingCheckinAttestation } from "@/lib/attest";
import { prisma } from "@/lib/prisma";
import { AttendanceBadge, attendanceDisplayStatus } from "@/components/StatusBadge";
import CheckinClient from "@/components/CheckinClient";
import WebauthnManager from "@/components/WebauthnManager";
import InstallPrompt from "@/components/InstallPrompt";
import { listMyCredentials, listPendingCredentials, decidePendingCredential } from "@/actions/webauthn";
import PendingDevicesPanel from "@/components/PendingDevicesPanel";
import DeleteRecordButton from "@/components/DeleteRecordButton";
import EditAttendanceButton from "@/components/EditAttendanceButton";
import Link from "next/link";
import TableFilter from "@/components/TableFilter";
import { getCheckinPolicy, workHoursForSite } from "@/lib/settings";
import type { CredentialState } from "@/components/CheckinClient";
import { bangkokDateKey, formatDate, formatTime, todayAtMidnight } from "@/lib/date";
import { isWorkday, loadWorkCalendar } from "@/lib/workdays";
import { getAssignedSites, type AssignedSites } from "@/lib/geo";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";

/** The teacher's sites — same list the check-in/out server actions accept (see getAssignedSites), so what a teacher sees here always matches what happens when they tap the button. */
function SiteRows({ sites, dict }: { sites: AssignedSites; dict: Dictionary }) {
  if (sites.all.length === 0) {
    return <p className="text-sm text-danger">{dict.actions.checkin.noSiteAssigned}</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {sites.all.map((site, i) => (
        <li key={site.id} className="text-sm">
          📍 <span className="font-medium">{site.name}</span>
          <span className="ml-1 text-faint">
            ({dict.locations.radiusLabel} {site.radiusMeters} {dict.locations.metersShort})
          </span>
          {i > 0 || !sites.primary ? <span className="ml-1.5 rounded-full bg-page px-2 py-0.5 text-[11px] text-muted">{dict.checkin.extraSiteTag}</span> : null}
          {site.workStart || site.workEnd ? (
            <span className="ml-1.5 text-xs text-faint">🕗 {site.workStart ?? "–"}–{site.workEnd ?? "–"}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default async function CheckinPage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "ADMIN";
  const date = todayAtMidnight();
  const locale = getLocale();
  const dict = getDictionary(locale);

  if (!isAdmin) {
    const [attendance, sites, credentials, policy] = await Promise.all([
      prisma.attendance.findUnique({
        where: { userId_date: { userId: session.user.id, date } },
      }),
      getAssignedSites(session.user.id),
      listMyCredentials(),
      getCheckinPolicy(),
    ]);
    const hours = workHoursForSite(sites.primary, policy);
    const todayKey = bangkokDateKey();
    const dayOff = !isWorkday(await loadWorkCalendar(todayKey, todayKey), todayKey, sites.primary?.id ?? null);
    const credentialState: CredentialState = credentials.some((c) => !c.pending)
      ? "approved"
      : credentials.length > 0
        ? "pending"
        : "none";
    const attestPending =
      !!attendance && !attendance.checkinAt && !!attendance.checkoutAt && (await hasPendingCheckinAttestation(session.user.id, date));

    return (
      <div className="flex flex-col gap-6">
        <InstallPrompt />
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <div className="mb-4 flex justify-center">
            <AttendanceBadge status={attendance?.status ?? "PENDING"} row={attendance} dict={dict} dayOff={dayOff} />
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
          <div className="mt-4 flex justify-center gap-6 text-sm text-subtle">
            <span>{dict.checkin.checkinShort}: {formatTime(attendance?.checkinAt, locale) ?? "—"}</span>
            <span>{dict.checkin.checkoutShort}: {formatTime(attendance?.checkoutAt, locale) ?? "—"}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{dict.checkin.todaySiteTitle}</h2>
          <p className="mb-3 text-sm text-muted">{dict.checkin.todaySiteHint}</p>
          <SiteRows sites={sites} dict={dict} />
          <p className="mt-1 text-sm text-subtle">
            🕗 {dict.checkin.workHours(hours.start, hours.end)}
            {hours.graceMinutes > 0 && <span className="ml-1 text-faint">{dict.checkin.graceNote(hours.graceMinutes)}</span>}
          </p>
        </div>

        <div id="devices">
          <WebauthnManager initialCredentials={credentials} approvalRequired={policy.deviceApprovalRequired} />
        </div>
      </div>
    );
  }

  const [teachers, attendances, pendingDevices] = await Promise.all([
    prisma.user.findMany({ where: { role: "MEMBER", isActive: true }, include: { department: true, campusLocation: true } }),
    prisma.attendance.findMany({ where: { date } }),
    listPendingCredentials(),
  ]);
  const byUser = new Map(attendances.map((a) => [a.userId, a]));
  // Weekend / school-calendar holiday at each teacher's school → "วันหยุด", not "ยังไม่เช็คอิน".
  const todayKey = bangkokDateKey();
  const cal = await loadWorkCalendar(todayKey, todayKey);
  const off = (siteId: string | null) => !isWorkday(cal, todayKey, siteId);
  // Filter options come from the rows themselves (no extra queries).
  const uniq = (pairs: [string, string][]) => Array.from(new Map(pairs).entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "th"));
  const deptOptions = uniq(teachers.map((t) => [t.departmentId ?? "-", t.department?.name ?? "—"] as [string, string]));
  const siteOptions = uniq(teachers.map((t) => [t.campusLocationId ?? "-", t.campusLocation?.name ?? "—"] as [string, string]));
  const hhmm = (d: Date | null) =>
    d ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }) : "";

  const Method = ({ m }: { m: string | null | undefined }) =>
    !m ? null : (
      <span className="ml-1 text-[10px] text-faint" title={m === "webauthn" ? dict.checkin.methodBiometric : dict.checkin.methodPassword}>
        {m === "webauthn" ? "🔒" : "🔑"}
      </span>
    );
  const Thumb = ({ id }: { id: string | null | undefined }) =>
    !id ? null : (
      <a href={`/api/selfies/${id}`} target="_blank" rel="noopener" className="ml-1 inline-block align-middle" title={dict.checkin.viewSelfie}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/selfies/${id}`} alt="" className="h-8 w-8 rounded-md object-cover ring-1 ring-line" />
      </a>
    );

  return (
    <div className="flex flex-col gap-6">
    <PendingDevicesPanel initial={pendingDevices} decide={decidePendingCredential} />
    <div id="checkin-overview" className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{dict.checkin.overviewTitle}</h2>
      <p className="mb-3 text-sm text-muted">{dict.checkin.overviewHint}</p>
      <TableFilter
        targetId="checkin-overview"
        pageSize={50}
        selects={[
          { attr: "status", label: dict.filter.status, options: Object.entries(dict.status.attendance).map(([value, label]) => ({ value, label })) },
          { attr: "dept", label: dict.filter.department, options: deptOptions },
          { attr: "site", label: dict.filter.site, options: siteOptions },
        ]}
      />
      <div className="overflow-x-auto">
        <table className="table-stack w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-faint">
              <th className="pb-2">{dict.dashboard.admin.colTeacher}</th>
              <th className="pb-2">{dict.teachers.colSite}</th>
              <th className="pb-2">{dict.dashboard.admin.colStatus}</th>
              <th className="pb-2">{dict.checkin.colCheckin}</th>
              <th className="pb-2">{dict.checkin.colCheckout}</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => {
              const a = byUser.get(t.id);
              return (
                <tr key={t.id} data-status={attendanceDisplayStatus(a?.status ?? "PENDING", a, off(t.campusLocationId))} data-dept={t.departmentId ?? "-"} data-site={t.campusLocationId ?? "-"} className="border-t border-line-soft">
                  <td className="py-2">
                    {t.name}
                    {a?.flagSharedDevice && (
                      <span className="ml-2 badge bg-danger-soft text-danger" title={dict.checkin.sharedDeviceHint}>
                        ⚠ {dict.checkin.sharedDevice}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {t.campusLocation ? (
                      <>📍 {t.campusLocation.name}</>
                    ) : (
                      <span className="text-faint">{dict.teachers.siteUnset}</span>
                    )}
                    {/* Stamped at another of their sites (teachers who move between sites). */}
                    {a?.checkinSiteId && a.checkinSiteId !== t.campusLocationId && (
                      <span className="block text-[11px] text-muted">{dict.checkin.inAtSite(a.checkinSiteName ?? "-")}</span>
                    )}
                    {a?.checkoutSiteId && a.checkoutSiteId !== (a.checkinSiteId ?? t.campusLocationId) && (
                      <span className="block text-[11px] text-muted">{dict.checkin.outAtSite(a.checkoutSiteName ?? "-")}</span>
                    )}
                  </td>
                  <td className="py-2"><AttendanceBadge status={a?.status ?? "PENDING"} row={a} dict={dict} dayOff={off(t.campusLocationId)} /></td>
                  <td className="py-2">
                    {formatTime(a?.checkinAt, locale) ?? "—"} {a?.attestedCheckin && <span className="text-[10px] text-warn">{dict.checkin.attested}</span>}
                    <Method m={a?.checkinMethod} />
                    <Thumb id={a?.checkinSelfieId} />
                  </td>
                  <td className="py-2">
                    {formatTime(a?.checkoutAt, locale) ?? "—"} {a?.attestedCheckout && <span className="text-[10px] text-warn">{dict.checkin.attested}</span>}
                    {a?.earlyCheckout && <span className="ml-1 badge bg-warn-soft text-warn" title={dict.checkin.earlyHint}>{dict.checkin.early}</span>}
                    <Method m={a?.checkoutMethod} />
                    <Thumb id={a?.checkoutSelfieId} />
                  </td>
                  <td className="py-2 text-right">
                    <span className="inline-flex items-center gap-2">
                      <Link href={`/admin/users/${t.id}/history`} className="whitespace-nowrap text-[11px] font-medium text-brand-ink hover:underline">
                        {dict.checkin.historyLink}
                      </Link>
                      {/* Admin can wipe today's row (a wrong tap, a test) right here — same action + audit as the history page. */}
                      {a && (
                        <EditAttendanceButton
                          id={a.id}
                          label={`${t.name} · ${formatDate(date, locale)}`}
                          checkin={hhmm(a.checkinAt)}
                          checkout={hhmm(a.checkoutAt)}
                          status={a.status}
                        />
                      )}
                      {a && <DeleteRecordButton kind="attendance" id={a.id} label={`${t.name} · ${formatDate(date, locale)}`} />}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-faint">{dict.checkin.legend}</p>
      <p className="mt-1 text-[11px] text-faint">{dict.checkin.deleteHint}</p>
    </div>
    </div>
  );
}
