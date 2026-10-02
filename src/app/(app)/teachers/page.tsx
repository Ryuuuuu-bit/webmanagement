import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { AttendanceBadge, attendanceDisplayStatus } from "@/components/StatusBadge";
import { bangkokDateKey, todayAtMidnight } from "@/lib/date";
import { isWorkday, loadWorkCalendar } from "@/lib/workdays";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import TableFilter from "@/components/TableFilter";

export default async function TeachersPage() {
  const session = await requireUser();
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const locale = getLocale();
  const dict = getDictionary(locale);
  const date = todayAtMidnight();
  const [teachers, attendances] = await Promise.all([
    prisma.user.findMany({
      where: { role: "MEMBER", isActive: true },
      include: { department: true, campusLocation: true },
      orderBy: { name: "asc" },
    }),
    prisma.attendance.findMany({ where: { date } }),
  ]);
  const byUser = new Map(attendances.map((a) => [a.userId, a]));
  // Weekend / school-calendar holiday at each teacher's school → "วันหยุด", not "ยังไม่เช็คอิน".
  const todayKey = bangkokDateKey();
  const cal = await loadWorkCalendar(todayKey, todayKey);
  const off = (siteId: string | null) => !isWorkday(cal, todayKey, siteId);
  // Filter options come from the rows themselves (no extra queries).
  const uniq = (pairs: [string, string][]) => Array.from(new Map(pairs).entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "th"));
  const deptOptions = uniq(teachers.map((t) => [t.departmentId ?? "-", t.department?.name ?? "—"] as [string, string]));
  const projectOptions = uniq(teachers.filter((t) => t.project).map((t) => [t.project!, t.project!] as [string, string]));
  const siteOptions = uniq(teachers.map((t) => [t.campusLocationId ?? "-", t.campusLocation?.name ?? "—"] as [string, string]));

  return (
    <div id="teachers-table" className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="mb-3 text-base font-bold">{dict.teachers.title}</h2>
      <TableFilter
        targetId="teachers-table"
        pageSize={50}
        selects={[
          { attr: "dept", label: dict.filter.department, options: deptOptions },
          { attr: "site", label: dict.filter.site, options: siteOptions },
          ...(projectOptions.length ? [{ attr: "project", label: dict.teachers.colProject, options: projectOptions }] : []),
          { attr: "status", label: dict.filter.status, options: Object.entries(dict.status.attendance).map(([value, label]) => ({ value, label })) },
        ]}
      />
      <div className="overflow-x-auto">
        <table className="table-stack w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-faint">
              <th className="pb-2">{dict.teachers.colName}</th><th className="pb-2">{dict.teachers.colEmail}</th><th className="pb-2">{dict.teachers.colDepartment}</th><th className="pb-2">{dict.teachers.colSite}</th>{projectOptions.length > 0 && <th className="pb-2">{dict.teachers.colProject}</th>}<th className="pb-2">{dict.teachers.colRole}</th><th className="pb-2">{dict.teachers.colStatusToday}</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => (
              <tr key={t.id} data-status={attendanceDisplayStatus(byUser.get(t.id)?.status ?? "PENDING", byUser.get(t.id), off(t.campusLocationId))} data-dept={t.departmentId ?? "-"} data-site={t.campusLocationId ?? "-"} data-project={t.project ?? ""} className="border-t border-line-soft">
                <td className="py-2">
                  {t.name}
                  {t.nickname && <span className="ml-1 text-xs text-faint">({t.nickname})</span>}
                </td>
                <td className="py-2 text-muted">{t.email}</td>
                <td className="py-2">{t.department?.name ?? "—"}</td>
                <td className="py-2">
                  {t.campusLocation ? `📍 ${t.campusLocation.name}` : <span className="text-faint">{dict.teachers.siteUnset}</span>}
                </td>
                {projectOptions.length > 0 && <td className="py-2">{t.project ?? "—"}</td>}
                <td className="py-2"><span className="badge bg-info-soft text-info">{t.role === "ADMIN" ? dict.sidebar.roleAdmin : dict.sidebar.roleMember}</span></td>
                <td className="py-2"><AttendanceBadge status={byUser.get(t.id)?.status ?? "PENDING"} row={byUser.get(t.id)} dict={dict} dayOff={off(t.campusLocationId)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
