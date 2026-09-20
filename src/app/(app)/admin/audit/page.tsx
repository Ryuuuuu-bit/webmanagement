import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime } from "@/lib/date";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

const PAGE_SIZE = 200;

type AuditRow = { id: string; at: Date; action: string; actorId: string | null; targetUserId: string | null; ip: string | null; detail: string | null };

/**
 * Admin-only security audit trail (see src/lib/audit.ts): sign-ins,
 * failures/lockouts, password and passkey events, account changes — newest
 * first. Read-only; the app never deletes audit rows.
 */
export default async function AdminAuditPage() {
  const session = await requireUser();
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  const locale = getLocale();
  const dict = getDictionary(locale);

  const rows: AuditRow[] = await prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: PAGE_SIZE });
  const ids = Array.from(new Set(rows.flatMap((r: AuditRow) => [r.actorId, r.targetUserId]).filter((x: string | null): x is string => !!x)));
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const failureActions = new Set(["LOGIN_FAILED", "LOGIN_LOCKED", "LOGIN_SUSPENDED", "LOGIN_TEMP_EXPIRED"]);
  const adminActions = new Set([
    "PASSWORD_RESET_BY_ADMIN", "USER_CREATED", "USER_SUSPENDED", "USER_REACTIVATED", "USER_DELETED", "ROLE_CHANGED",
    "ENROLLMENT_LINK_CREATED", "PASSKEYS_CLEARED_BY_ADMIN", "PASSWORD_SETUP_EMAIL_SENT", "USERNAME_CHANGED",
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold">{dict.audit.title}</h1>
        <p className="mt-1 text-sm text-muted">{dict.audit.hint(PAGE_SIZE)}</p>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{dict.audit.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-faint">
                  <th className="pb-2 pr-3">{dict.audit.colTime}</th>
                  <th className="pb-2 pr-3">{dict.audit.colAction}</th>
                  <th className="pb-2 pr-3">{dict.audit.colActor}</th>
                  <th className="pb-2 pr-3">{dict.audit.colTarget}</th>
                  <th className="pb-2 pr-3">{dict.audit.colIp}</th>
                  <th className="pb-2">{dict.audit.colDetail}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: AuditRow) => {
                  const label = dict.audit.actions[r.action as keyof typeof dict.audit.actions] ?? r.action;
                  const tone = failureActions.has(r.action)
                    ? "bg-danger-soft text-danger"
                    : adminActions.has(r.action)
                      ? "bg-info-soft text-info"
                      : "bg-ok-soft text-ok";
                  return (
                    <tr key={r.id} className="border-t border-line-soft align-top">
                      <td className="whitespace-nowrap py-2 pr-3 text-xs text-muted">
                        {formatDate(r.at, locale)} {formatTime(r.at, locale)}
                      </td>
                      <td className="py-2 pr-3"><span className={`badge ${tone}`}>{label}</span></td>
                      <td className="py-2 pr-3">{r.actorId ? nameOf.get(r.actorId) ?? "—" : <span className="text-faint">—</span>}</td>
                      <td className="py-2 pr-3">{r.targetUserId ? nameOf.get(r.targetUserId) ?? dict.audit.deletedUser : <span className="text-faint">—</span>}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-muted">{r.ip ?? "—"}</td>
                      <td className="py-2 text-xs text-muted">{r.detail ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
