import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AttendanceBadge } from "@/components/StatusBadge";
import { todayAtMidnight } from "@/lib/date";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function TeachersPage() {
  const session = await getServerSession(authOptions);
  if (session!.user.role !== "ADMIN") redirect("/dashboard");

  const locale = getLocale();
  const dict = getDictionary(locale);
  const date = todayAtMidnight();
  const [teachers, attendances] = await Promise.all([
    prisma.user.findMany({
      where: { role: "MEMBER" },
      include: { department: true, campusLocation: true },
      orderBy: { name: "asc" },
    }),
    prisma.attendance.findMany({ where: { date } }),
  ]);
  const byUser = new Map(attendances.map((a) => [a.userId, a]));

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{dict.teachers.title}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-faint">
              <th className="pb-2">{dict.teachers.colName}</th><th className="pb-2">{dict.teachers.colEmail}</th><th className="pb-2">{dict.teachers.colDepartment}</th><th className="pb-2">{dict.teachers.colSite}</th><th className="pb-2">{dict.teachers.colRole}</th><th className="pb-2">{dict.teachers.colStatusToday}</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => (
              <tr key={t.id} className="border-t border-line-soft">
                <td className="py-2">{t.name}</td>
                <td className="py-2 text-muted">{t.email}</td>
                <td className="py-2">{t.department?.name ?? "—"}</td>
                <td className="py-2">
                  {t.campusLocation ? `📍 ${t.campusLocation.name}` : <span className="text-faint">{dict.teachers.siteUnset}</span>}
                </td>
                <td className="py-2"><span className="badge bg-info-soft text-info">{t.role}</span></td>
                <td className="py-2"><AttendanceBadge status={byUser.get(t.id)?.status ?? "PENDING"} dict={dict} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
