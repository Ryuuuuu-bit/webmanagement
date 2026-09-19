import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AttendanceBadge } from "@/components/StatusBadge";
import CheckinClient from "@/components/CheckinClient";
import { formatTime, todayAtMidnight } from "@/lib/date";

export default async function CheckinPage() {
  const session = await getServerSession(authOptions);
  const isAdmin = session!.user.role === "ADMIN";
  const date = todayAtMidnight();

  if (!isAdmin) {
    const attendance = await prisma.attendance.findUnique({
      where: { userId_date: { userId: session!.user.id, date } },
    });
    const locations = await prisma.campusLocation.findMany();

    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <div className="mb-4 flex justify-center">
            <AttendanceBadge status={attendance?.status ?? "PENDING"} />
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
            <span>เข้า: {formatTime(attendance?.checkinAt) ?? "—"}</span>
            <span>ออก: {formatTime(attendance?.checkoutAt) ?? "—"}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">สถานที่ที่อนุญาตให้เช็คอิน/เช็คเอาต์</h2>
          <p className="mb-3 text-sm text-muted">ลืมเช็คอิน/เช็คเอาต์วันไหน ไปที่เมนู “ขอรับรองเวลา”</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-faint">
                <th className="pb-2">สถานที่</th>
                <th className="pb-2">รัศมี</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id} className="border-t border-line-soft">
                  <td className="py-2">{l.name}</td>
                  <td className="py-2">{l.radiusMeters} เมตร</td>
                </tr>
              ))}
            </tbody>
          </table>
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
      <h2 className="text-base font-bold">ภาพรวมการเข้า-ออกงานวันนี้</h2>
      <p className="mb-3 text-sm text-muted">เช็คอินและเช็คเอาต์ต้องอยู่ในพื้นที่มหาวิทยาลัย</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-faint">
              <th className="pb-2">อาจารย์</th>
              <th className="pb-2">สถานะ</th>
              <th className="pb-2">เช็คอิน</th>
              <th className="pb-2">เช็คเอาต์</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t) => {
              const a = byUser.get(t.id);
              return (
                <tr key={t.id} className="border-t border-line-soft">
                  <td className="py-2">{t.name}</td>
                  <td className="py-2"><AttendanceBadge status={a?.status ?? "PENDING"} /></td>
                  <td className="py-2">
                    {formatTime(a?.checkinAt) ?? "—"} {a?.attestedCheckin && <span className="text-[10px] text-warn">(รับรอง)</span>}
                  </td>
                  <td className="py-2">
                    {formatTime(a?.checkoutAt) ?? "—"} {a?.attestedCheckout && <span className="text-[10px] text-warn">(รับรอง)</span>}
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
