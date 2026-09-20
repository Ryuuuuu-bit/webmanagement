import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { AttendanceBadge } from "@/components/StatusBadge";
import CheckinClient from "@/components/CheckinClient";
import WebauthnManager from "@/components/WebauthnManager";
import InstallPrompt from "@/components/InstallPrompt";
import { listMyCredentials, listPendingCredentials, decidePendingCredential } from "@/actions/webauthn";
import PendingDevicesPanel from "@/components/PendingDevicesPanel";
import DeleteRecordButton from "@/components/DeleteRecordButton";
import Link from "next/link";
import { getCheckinPolicy } from "@/lib/settings";
import type { CredentialState } from "@/components/CheckinClient";
import { formatDate, formatTime, todayAtMidnight } from "@/lib/date";
import { getExpectedSite, type ExpectedSiteResult } from "@/lib/geo";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, type Dictionary } from "@/lib/i18n/dictionaries";

/** Renders the teacher's assigned site — same two outcomes the check-in/out server actions themselves branch on (see getExpectedSite), so what a teacher sees here always matches what actually happens when they tap the button. */
function SiteRow({ result, dict }: { result: ExpectedSiteResult; dict: Dictionary }) {
  if (result.kind === "no_site") {
    return <p className="text-sm text-danger">{dict.actions.checkin.noSiteAssigned}</p>;
  }
  return (
    <p className="text-sm">
      📍 <span className="font-medium">{result.site.name}</span>
      <span className="ml-1 text-faint">
        ({dict.locations.radiusLabel} {result.site.radiusMeters} {dict.locations.metersShort})
      </span>
    </p>
  );
}

export default async function CheckinPage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "ADMIN";
  const date = todayAtMidnight();
  const locale = getLocale();
  const dict = getDictionary(locale);

  if (!isAdmin) {
    const [attendance, site, credentials, policy] = await Promise.all([
      prisma.attendance.findUnique({
        where: { userId_date: { userId: session.user.id, date } },
      }),
      getExpectedSite(session.user.id),
      listMyCredentials(),
      getCheckinPolicy(),
    ]);
    const credentialState: CredentialState = credentials.some((c) => !c.pending)
      ? "approved"
      : credentials.length > 0
        ? "pending"
        : "none";

    return (
      <div className="flex flex-col gap-6">
        <InstallPrompt />
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
            credentialState={credentialState}
            policy={policy}
          />
          <div className="mt-4 flex justify-center gap-6 text-sm text-subtle">
            <span>{dict.checkin.checkinShort}: {formatTime(attendance?.checkinAt, locale) ?? "—"}</span>
            <span>{dict.checkin.checkoutShort}: {formatTime(attendance?.checkoutAt, locale) ?? "—"}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{dict.checkin.todaySiteTitle}</h2>
          <p className="mb-3 text-sm text-muted">{dict.checkin.todaySiteHint}</p>
          <SiteRow result={site} dict={dict} />
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
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{dict.checkin.overviewTitle}</h2>
      <p className="mb-3 text-sm text-muted">{dict.checkin.overviewHint}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
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
                <tr key={t.id} className="border-t border-line-soft">
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
                  </td>
                  <td className="py-2"><AttendanceBadge status={a?.status ?? "PENDING"} dict={dict} /></td>
                  <td className="py-2">
                    {formatTime(a?.checkinAt, locale) ?? "—"} {a?.attestedCheckin && <span className="text-[10px] text-warn">{dict.checkin.attested}</span>}
                    <Method m={a?.checkinMethod} />
                    <Thumb id={a?.checkinSelfieId} />
                  </td>
                  <td className="py-2">
                    {formatTime(a?.checkoutAt, locale) ?? "—"} {a?.attestedCheckout && <span className="text-[10px] text-warn">{dict.checkin.attested}</span>}
                    <Method m={a?.checkoutMethod} />
                    <Thumb id={a?.checkoutSelfieId} />
                  </td>
                  <td className="py-2 text-right">
                    <span className="inline-flex items-center gap-2">
                      <Link href={`/admin/users/${t.id}/history`} className="whitespace-nowrap text-[11px] font-medium text-brand-ink hover:underline">
                        {dict.checkin.historyLink}
                      </Link>
                      {/* Admin can wipe today's row (a wrong tap, a test) right here — same action + audit as the history page. */}
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
