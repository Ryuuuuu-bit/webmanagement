import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AttendanceBadge } from "@/components/StatusBadge";
import { todayAtMidnight } from "@/lib/date";

export default async function TeachersPage() {
  const session = await getServerSession(authOptions);
  if (session!.user.role !== "ADMIN") redirect("/dashboard");

  const date = todayAtMidnight();
  const [teachers, attendances] = await Promise.all([
    prisma.user.findMany({ where: { role: "MEMBER" }, include: { department: true }, orderBy: { name: "asc" } }),
    prisma.attendance.findMany({ where: { date } }),
  ]);
  const byUser = new Map(attendances.map((a) => [a.userId, a]));

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-base font-bold">รายชื่ออาจารย์ทั้งหมด</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-black/40">
              <th className="pb-2">ชื่อ</th><th className="pb-2">อีเมล</th><th className="pb-2">ภาควิชา</th><th className="pb-2">บทบาท</th><th className="pb-2">สถานะวันนี้</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => (
              <tr key={t.id} className="border-t border-black/5">
                <td className="py-2">{t.name}</td>
                <td className="py-2 text-black/50">{t.email}</td>
                <td className="py-2">{t.department?.name ?? "—"}</td>
                <td className="py-2"><span className="badge bg-info-soft text-info">{t.role}</span></td>
                <td className="py-2"><AttendanceBadge status={byUser.get(t.id)?.status ?? "PENDING"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
