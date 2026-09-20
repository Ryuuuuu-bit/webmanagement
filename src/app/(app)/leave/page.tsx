import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { requestLeave, decideLeave } from "@/actions/leave";
import { RequestBadge } from "@/components/StatusBadge";
import DecisionButtons from "@/components/DecisionButtons";
import LeaveForm from "@/components/LeaveForm";
import { formatDate } from "@/lib/date";
import { getLeaveQuotaMap, getLeaveQuotaStatusForUser, getLeaveUsedDays } from "@/lib/leaveQuota";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function LeavePage() {
  const session = await requireUser();
  const canApprove = session.user.role === "ADMIN";
  const locale = getLocale();
  const dict = getDictionary(locale);

  if (!canApprove) {
    const [mine, quotaStatus] = await Promise.all([
      prisma.leaveRequest.findMany({
        where: { requesterId: session.user.id },
        orderBy: { createdAt: "desc" },
      }),
      getLeaveQuotaStatusForUser(session.user.id),
    ]);

    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{dict.leave.requestTitle}</h2>
          <div className="mt-3">
            <LeaveForm requestLeave={requestLeave} quotaStatus={quotaStatus} />
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{dict.leave.myHistoryTitle}</h2>
          {mine.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{dict.leave.noHistory}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-faint">
                    <th className="pb-2">{dict.leave.colType}</th><th className="pb-2">{dict.leave.colDate}</th><th className="pb-2">{dict.leave.colReason}</th><th className="pb-2">{dict.leave.colStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((l) => (
                    <tr key={l.id} className="border-t border-line-soft">
                      <td className="py-2">{dict.leave.types[l.type as keyof typeof dict.leave.types]}</td>
                      <td className="py-2">{formatDate(l.startDate, locale)} – {formatDate(l.endDate, locale)}</td>
                      <td className="py-2">{l.reason}</td>
                      <td className="py-2"><RequestBadge status={l.status} dict={dict} /></td>
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

  const [pendingRaw, done, quotaMap] = await Promise.all([
    prisma.leaveRequest.findMany({ where: { status: "PENDING" }, include: { requester: true }, orderBy: { createdAt: "asc" } }),
    prisma.leaveRequest.findMany({ where: { status: { not: "PENDING" } }, include: { requester: true }, orderBy: { decidedAt: "desc" }, take: 20 }),
    getLeaveQuotaMap(),
  ]);

  // Flag any pending request that (together with the requester's other
  // pending/approved leave of the same type this year) exceeds their quota —
  // shown to Admin as a heads-up while deciding, not a block (see
  // src/lib/leaveQuota.ts; getLeaveUsedDays already counts this pending row).
  const pending = await Promise.all(
    pendingRaw.map(async (l) => {
      const quota = quotaMap[l.type];
      const used = quota > 0 ? await getLeaveUsedDays(l.requesterId, l.type, l.startDate.getUTCFullYear()) : 0;
      return { ...l, overQuota: quota > 0 && used > quota, quotaUsed: used, quotaDays: quota };
    })
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{dict.leave.pendingTitle}</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{dict.leave.noPending}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-faint">
                  <th className="pb-2">{dict.leave.colTeacher}</th><th className="pb-2">{dict.leave.colType}</th><th className="pb-2">{dict.leave.colDate}</th><th className="pb-2">{dict.leave.colReason}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((l) => (
                  <tr key={l.id} className="border-t border-line-soft">
                    <td className="py-2">{l.requester!.name}</td>
                    <td className="py-2">{dict.leave.types[l.type as keyof typeof dict.leave.types]}</td>
                    <td className="py-2">{formatDate(l.startDate, locale)} – {formatDate(l.endDate, locale)}</td>
                    <td className="py-2">
                      {l.reason}
                      {l.overQuota && (
                        <span className="mt-0.5 block text-[10px] font-semibold text-danger">
                          {dict.leave.overQuotaNote(l.quotaUsed, l.quotaDays)}
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <DecisionButtons
                        onApprove={decideLeave.bind(null, l.id, "APPROVED")}
                        onReject={decideLeave.bind(null, l.id, "REJECTED")}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{dict.leave.decidedTitle}</h2>
        <div className="overflow-x-auto">
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-faint">
                <th className="pb-2">{dict.leave.colTeacher}</th><th className="pb-2">{dict.leave.colType}</th><th className="pb-2">{dict.leave.colDate}</th><th className="pb-2">{dict.leave.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {done.map((l) => (
                <tr key={l.id} className="border-t border-line-soft">
                  <td className="py-2">{l.requester!.name}</td>
                  <td className="py-2">{dict.leave.types[l.type as keyof typeof dict.leave.types]}</td>
                  <td className="py-2">{formatDate(l.startDate, locale)} – {formatDate(l.endDate, locale)}</td>
                  <td className="py-2"><RequestBadge status={l.status} dict={dict} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
