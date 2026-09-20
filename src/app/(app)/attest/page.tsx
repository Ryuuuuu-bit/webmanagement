import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { requestAttestation, decideAttestation } from "@/actions/attest";
import { RequestBadge } from "@/components/StatusBadge";
import DecisionButtons from "@/components/DecisionButtons";
import AttestForm from "@/components/AttestForm";
import { formatDate, formatTimeLabel } from "@/lib/date";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary, type Dictionary, type Locale } from "@/lib/i18n/dictionaries";

/** "ลืมทั้งสองอย่าง" (forgot both) carries two distinct times (check-in/check-out); everything else is a single time. */
function requestedTimeLabel(
  dict: Dictionary,
  locale: Locale,
  r: { type: string; requestedTime: string; requestedCheckoutTime: string | null }
) {
  if (r.type === "FORGOT_BOTH" && r.requestedCheckoutTime) {
    return `${dict.attest.checkinLabel} ${formatTimeLabel(r.requestedTime, locale)} / ${dict.attest.checkoutLabel} ${formatTimeLabel(r.requestedCheckoutTime, locale)}`;
  }
  return formatTimeLabel(r.requestedTime, locale);
}

export default async function AttestPage() {
  const session = await requireUser();
  const canApprove = session.user.role === "ADMIN";
  const locale = getLocale();
  const dict = getDictionary(locale);

  if (!canApprove) {
    const mine = await prisma.timeAttestation.findMany({
      where: { requesterId: session.user.id },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{dict.attest.requestTitle}</h2>
          <p className="mb-3 text-sm text-muted">
            {dict.attest.requestHint}
          </p>
          <AttestForm requestAttestation={requestAttestation} />
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{dict.attest.myHistoryTitle}</h2>
          {mine.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{dict.attest.noHistory}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-faint">
                    <th className="pb-2">{dict.attest.colDate}</th><th className="pb-2">{dict.attest.colType}</th><th className="pb-2">{dict.attest.colRequestedTime}</th><th className="pb-2">{dict.attest.colReason}</th><th className="pb-2">{dict.attest.colStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((r) => (
                    <tr key={r.id} className="border-t border-line-soft">
                      <td className="py-2">{formatDate(r.date, locale)}</td>
                      <td className="py-2">{dict.attest.types[r.type as keyof typeof dict.attest.types]}</td>
                      <td className="py-2">{requestedTimeLabel(dict, locale, r)}</td>
                      <td className="py-2">{r.reason}</td>
                      <td className="py-2"><RequestBadge status={r.status} dict={dict} /></td>
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

  const [pending, done] = await Promise.all([
    prisma.timeAttestation.findMany({ where: { status: "PENDING" }, include: { requester: true }, orderBy: { createdAt: "asc" } }),
    prisma.timeAttestation.findMany({ where: { status: { not: "PENDING" } }, include: { requester: true }, orderBy: { decidedAt: "desc" }, take: 20 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{dict.attest.pendingTitle}</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{dict.attest.noPending}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-faint">
                  <th className="pb-2">{dict.attest.colTeacher}</th><th className="pb-2">{dict.attest.colDate}</th><th className="pb-2">{dict.attest.colType}</th><th className="pb-2">{dict.attest.colRequestedTime}</th><th className="pb-2">{dict.attest.colReason}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id} className="border-t border-line-soft">
                    <td className="py-2">{r.requester!.name}</td>
                    <td className="py-2">{formatDate(r.date, locale)}</td>
                    <td className="py-2">{dict.attest.types[r.type as keyof typeof dict.attest.types]}</td>
                    <td className="py-2">{requestedTimeLabel(dict, locale, r)}</td>
                    <td className="py-2">{r.reason}</td>
                    <td className="py-2">
                      <DecisionButtons
                        onApprove={decideAttestation.bind(null, r.id, "APPROVED")}
                        onReject={decideAttestation.bind(null, r.id, "REJECTED")}
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
        <h2 className="text-base font-bold">{dict.attest.decidedTitle}</h2>
        <div className="overflow-x-auto">
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-faint">
                <th className="pb-2">{dict.attest.colTeacher}</th><th className="pb-2">{dict.attest.colDate}</th><th className="pb-2">{dict.attest.colType}</th><th className="pb-2">{dict.attest.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {done.map((r) => (
                <tr key={r.id} className="border-t border-line-soft">
                  <td className="py-2">{r.requester!.name}</td>
                  <td className="py-2">{formatDate(r.date, locale)}</td>
                  <td className="py-2">{dict.attest.types[r.type as keyof typeof dict.attest.types]}</td>
                  <td className="py-2"><RequestBadge status={r.status} dict={dict} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
