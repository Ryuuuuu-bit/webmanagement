import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AttendanceBadge } from "@/components/StatusBadge";
import { DAY_LABELS, PERIOD_LABELS, formatTime, todayAtMidnight, toWeekdayIndex } from "@/lib/date";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const isAdmin = session!.user.role === "ADMIN";
  const date = todayAtMidnight();

  if (!isAdmin) {
    const [attendance, todaySchedule, pendingLeave, pendingAttest] = await Promise.all([
      prisma.attendance.findUnique({ where: { userId_date: { userId: session!.user.id, date } } }),
      prisma.schedule.findMany({
        where: { teacherId: session!.user.id, dayOfWeek: toWeekdayIndex(new Date()) },
        include: { course: true, room: true },
        orderBy: { periodIndex: "asc" },
      }),
      prisma.leaveRequest.count({ where: { requesterId: session!.user.id, status: "PENDING" } }),
      prisma.timeAttestation.count({ where: { requesterId: session!.user.id, status: "PENDING" } }),
    ]);

    return (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <StatTile label="สถานะเข้างานวันนี้" value={<AttendanceBadge status={attendance?.status ?? "PENDING"} />} />
          <StatTile label="เวลาเช็คอิน" value={formatTime(attendance?.checkinAt) ?? "—"} />
          <StatTile label="เวลาเช็คเอาต์" value={formatTime(attendance?.checkoutAt) ?? "—"} />
          <StatTile label="คำขอที่รออนุมัติ" value={String(pendingLeave + pendingAttest)} />
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold">ตารางสอนวันนี้</h2>
          <p className="mb-3 text-sm text-black/50">ดูตารางเต็มสัปดาห์ได้ที่เมนู “ตารางสอนของฉัน”</p>
          {todaySchedule.length === 0 ? (
            <p className="text-sm text-black/50">วันนี้ไม่มีคาบสอน</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-black/40">
                  <th className="pb-2">คาบเวลา</th>
                  <th className="pb-2">วิชา</th>
                  <th className="pb-2">ห้อง</th>
                </tr>
              </thead>
              <tbody>
                {todaySchedule.map((s) => (
                  <tr key={s.id} className="border-t border-black/5">
                    <td className="py-2">{PERIOD_LABELS[s.periodIndex]}</td>
                    <td className="py-2">{s.course!.code} {s.course!.name}</td>
                    <td className="py-2">{s.room!.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  const [teachers, attendances] = await Promise.all([
    prisma.user.findMany({ where: { role: "MEMBER" }, include: { department: true } }),
    prisma.attendance.findMany({ where: { date } }),
  ]);
  const byUser = new Map(attendances.map((a) => [a.userId, a]));
  const counts: Record<string, number> = {};
  for (const t of teachers) {
    const s = byUser.get(t.id)?.status ?? "PENDING";
    counts[s] = (counts[s] ?? 0) + 1;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-5">
        <StatTile label="อาจารย์ทั้งหมด" value={String(teachers.length)} />
        <StatTile label="ตรงเวลา" value={String(counts.ON_TIME ?? 0)} tone="ok" />
        <StatTile label="มาสาย" value={String(counts.LATE ?? 0)} tone="warn" />
        <StatTile label="ขาด" value={String(counts.ABSENT ?? 0)} tone="danger" />
        <StatTile label="ลา" value={String(counts.LEAVE ?? 0)} tone="info" />
      </div>

      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold">สถานะการเข้างานวันนี้</h2>
        <p className="mb-3 text-sm text-black/50">อัปเดตแบบเรียลไทม์จากการเช็คอิน</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-black/40">
                <th className="pb-2">อาจารย์</th>
                <th className="pb-2">ภาควิชา</th>
                <th className="pb-2">สถานะ</th>
                <th className="pb-2">เข้า</th>
                <th className="pb-2">ออก</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => {
                const a = byUser.get(t.id);
                return (
                  <tr key={t.id} className="border-t border-black/5">
                    <td className="py-2">{t.name}</td>
                    <td className="py-2">{t.department?.name ?? "—"}</td>
                    <td className="py-2"><AttendanceBadge status={a?.status ?? "PENDING"} /></td>
                    <td className="py-2">{formatTime(a?.checkinAt) ?? "—"}</td>
                    <td className="py-2">{formatTime(a?.checkoutAt) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "danger" | "info" }) {
  const toneCls = tone ? { ok: "text-ok", warn: "text-warn", danger: "text-danger", info: "text-info" }[tone] : "text-brand-ink";
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
      <div className={`text-xl font-semibold ${toneCls}`}>{value}</div>
      <div className="mt-1 text-xs text-black/50">{label}</div>
    </div>
  );
}
