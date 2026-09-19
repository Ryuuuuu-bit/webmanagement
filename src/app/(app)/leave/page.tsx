import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requestLeave, decideLeave } from "@/actions/leave";
import { RequestBadge } from "@/components/StatusBadge";
import DecisionButtons from "@/components/DecisionButtons";
import { formatDate } from "@/lib/date";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function LeavePage() {
  const session = await getServerSession(authOptions);
  const canApprove = session!.user.role === "ADMIN";
  const locale = getLocale();
  const dict = getDictionary(locale);

  if (!canApprove) {
    const mine = await prisma.leaveRequest.findMany({
      where: { requesterId: session!.user.id },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{dict.leave.requestTitle}</h2>
          <form action={requestLeave} className="mt-3 flex flex-col gap-3.5">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <Field label={dict.leave.fieldType}>
                <select name="type" className="input">
                  <option value="SICK">{dict.leave.types.SICK}</option>
                  <option value="PERSONAL">{dict.leave.types.PERSONAL}</option>
                  <option value="VACATION">{dict.leave.types.VACATION}</option>
                  <option value="MATERNITY">{dict.leave.types.MATERNITY}</option>
                  <option value="STERILIZATION">{dict.leave.types.STERILIZATION}</option>
                  <option value="MILITARY">{dict.leave.types.MILITARY}</option>
                  <option value="TRAINING">{dict.leave.types.TRAINING}</option>
                </select>
              </Field>
              <Field label={dict.leave.fieldFrom}><input type="date" name="from" required className="input" /></Field>
              <Field label={dict.leave.fieldTo}><input type="date" name="to" required className="input" /></Field>
            </div>
            <Field label={dict.leave.fieldReason}><textarea name="reason" className="input min-h-[70px]" placeholder={dict.leave.reasonPlaceholder} /></Field>
            <button type="submit" className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
              {dict.leave.submit}
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">{dict.leave.myHistoryTitle}</h2>
          {mine.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{dict.leave.noHistory}</p>
          ) : (
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
          )}
        </div>
      </div>
    );
  }

  const [pending, done] = await Promise.all([
    prisma.leaveRequest.findMany({ where: { status: "PENDING" }, include: { requester: true }, orderBy: { createdAt: "asc" } }),
    prisma.leaveRequest.findMany({ where: { status: { not: "PENDING" } }, include: { requester: true }, orderBy: { decidedAt: "desc" }, take: 20 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{dict.leave.pendingTitle}</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{dict.leave.noPending}</p>
        ) : (
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
                  <td className="py-2">{l.reason}</td>
                  <td className="py-2">
                    <DecisionButtons
                      onApprove={decideLeave.bind(null, l.id, "APPROVED")}
                      onReject={decideLeave.bind(null, l.id, "REJECTED")}
                      dict={dict}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{dict.leave.decidedTitle}</h2>
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
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
