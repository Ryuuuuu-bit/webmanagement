import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requestLeave, decideLeave } from "@/actions/leave";
import { RequestBadge } from "@/components/StatusBadge";
import DecisionButtons from "@/components/DecisionButtons";
import { formatDate } from "@/lib/date";

const TYPE_LABEL: Record<string, string> = {
  SICK: "ลาป่วย",
  PERSONAL: "ลากิจ",
  VACATION: "ลาพักร้อน",
  MATERNITY: "ลาคลอดบุตร",
  STERILIZATION: "ลาทำหมัน",
  MILITARY: "ลารับราชการทหาร",
  TRAINING: "ลาฝึกอบรม",
};

export default async function LeavePage() {
  const session = await getServerSession(authOptions);
  const canApprove = session!.user.role === "ADMIN";

  if (!canApprove) {
    const mine = await prisma.leaveRequest.findMany({
      where: { requesterId: session!.user.id },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">ยื่นคำขอลา</h2>
          <form action={requestLeave} className="mt-3 flex flex-col gap-3.5">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <Field label="ประเภทการลา">
                <select name="type" className="input">
                  <option value="SICK">ลาป่วย</option>
                  <option value="PERSONAL">ลากิจ</option>
                  <option value="VACATION">ลาพักร้อน</option>
                  <option value="MATERNITY">ลาคลอดบุตร</option>
                  <option value="STERILIZATION">ลาทำหมัน</option>
                  <option value="MILITARY">ลารับราชการทหาร</option>
                  <option value="TRAINING">ลาฝึกอบรม</option>
                </select>
              </Field>
              <Field label="วันที่เริ่ม"><input type="date" name="from" required className="input" /></Field>
              <Field label="วันที่สิ้นสุด"><input type="date" name="to" required className="input" /></Field>
            </div>
            <Field label="เหตุผล"><textarea name="reason" className="input min-h-[70px]" placeholder="ระบุเหตุผลโดยย่อ" /></Field>
            <button type="submit" className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
              ส่งคำขอลา
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">ประวัติการลาของฉัน</h2>
          {mine.length === 0 ? (
            <p className="mt-2 text-sm text-muted">ยังไม่มีประวัติการลา</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-faint">
                  <th className="pb-2">ประเภท</th><th className="pb-2">วันที่</th><th className="pb-2">เหตุผล</th><th className="pb-2">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((l) => (
                  <tr key={l.id} className="border-t border-line-soft">
                    <td className="py-2">{TYPE_LABEL[l.type]}</td>
                    <td className="py-2">{formatDate(l.startDate)} – {formatDate(l.endDate)}</td>
                    <td className="py-2">{l.reason}</td>
                    <td className="py-2"><RequestBadge status={l.status} /></td>
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
        <h2 className="text-base font-bold">คำขอลาที่รออนุมัติ</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted">ไม่มีคำขอค้างอนุมัติ</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-faint">
                <th className="pb-2">อาจารย์</th><th className="pb-2">ประเภท</th><th className="pb-2">วันที่</th><th className="pb-2">เหตุผล</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((l) => (
                <tr key={l.id} className="border-t border-line-soft">
                  <td className="py-2">{l.requester!.name}</td>
                  <td className="py-2">{TYPE_LABEL[l.type]}</td>
                  <td className="py-2">{formatDate(l.startDate)} – {formatDate(l.endDate)}</td>
                  <td className="py-2">{l.reason}</td>
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
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">ประวัติที่ดำเนินการแล้ว</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-faint">
              <th className="pb-2">อาจารย์</th><th className="pb-2">ประเภท</th><th className="pb-2">วันที่</th><th className="pb-2">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {done.map((l) => (
              <tr key={l.id} className="border-t border-line-soft">
                <td className="py-2">{l.requester!.name}</td>
                <td className="py-2">{TYPE_LABEL[l.type]}</td>
                <td className="py-2">{formatDate(l.startDate)} – {formatDate(l.endDate)}</td>
                <td className="py-2"><RequestBadge status={l.status} /></td>
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
