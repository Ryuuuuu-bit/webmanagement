import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requestAttestation, decideAttestation } from "@/actions/attest";
import { RequestBadge } from "@/components/StatusBadge";
import DecisionButtons from "@/components/DecisionButtons";
import AttestForm from "@/components/AttestForm";
import { formatDate, formatTimeLabel } from "@/lib/date";

const TYPE_LABEL: Record<string, string> = {
  FORGOT_CHECKIN: "ลืมเช็คอิน",
  FORGOT_CHECKOUT: "ลืมเช็คเอาต์",
  FORGOT_BOTH: "ลืมทั้งสองอย่าง",
};

/** "ลืมทั้งสองอย่าง" carries two distinct times (check-in/check-out); everything else is a single time. */
function requestedTimeLabel(r: { type: string; requestedTime: string; requestedCheckoutTime: string | null }) {
  if (r.type === "FORGOT_BOTH" && r.requestedCheckoutTime) {
    return `เข้า ${formatTimeLabel(r.requestedTime)} / ออก ${formatTimeLabel(r.requestedCheckoutTime)}`;
  }
  return formatTimeLabel(r.requestedTime);
}

export default async function AttestPage() {
  const session = await getServerSession(authOptions);
  const canApprove = session!.user.role === "ADMIN";

  if (!canApprove) {
    const mine = await prisma.timeAttestation.findMany({
      where: { requesterId: session!.user.id },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">ขอรับรองเวลา</h2>
          <p className="mb-3 text-sm text-muted">
            ใช้เมื่อลืมเช็คอินหรือเช็คเอาต์ในวันใดวันหนึ่ง — คำขอจะถูกส่งให้ Admin/Senior อนุมัติ
            และบันทึกแยกจากเวลาที่เช็คอินจริงผ่าน GPS (FR-13)
          </p>
          <AttestForm requestAttestation={requestAttestation} />
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-base font-bold">ประวัติคำขอของฉัน</h2>
          {mine.length === 0 ? (
            <p className="mt-2 text-sm text-muted">ยังไม่มีคำขอรับรองเวลา</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-faint">
                  <th className="pb-2">วันที่</th><th className="pb-2">ประเภท</th><th className="pb-2">เวลาที่ขอ</th><th className="pb-2">เหตุผล</th><th className="pb-2">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((r) => (
                  <tr key={r.id} className="border-t border-line-soft">
                    <td className="py-2">{formatDate(r.date)}</td>
                    <td className="py-2">{TYPE_LABEL[r.type]}</td>
                    <td className="py-2">{requestedTimeLabel(r)}</td>
                    <td className="py-2">{r.reason}</td>
                    <td className="py-2"><RequestBadge status={r.status} /></td>
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
    prisma.timeAttestation.findMany({ where: { status: "PENDING" }, include: { requester: true }, orderBy: { createdAt: "asc" } }),
    prisma.timeAttestation.findMany({ where: { status: { not: "PENDING" } }, include: { requester: true }, orderBy: { decidedAt: "desc" }, take: 20 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">คำขอรับรองเวลาที่รออนุมัติ</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted">ไม่มีคำขอค้างอนุมัติ</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-faint">
                <th className="pb-2">อาจารย์</th><th className="pb-2">วันที่</th><th className="pb-2">ประเภท</th><th className="pb-2">เวลาที่ขอ</th><th className="pb-2">เหตุผล</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id} className="border-t border-line-soft">
                  <td className="py-2">{r.requester!.name}</td>
                  <td className="py-2">{formatDate(r.date)}</td>
                  <td className="py-2">{TYPE_LABEL[r.type]}</td>
                  <td className="py-2">{requestedTimeLabel(r)}</td>
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
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">ประวัติที่ดำเนินการแล้ว</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-faint">
              <th className="pb-2">อาจารย์</th><th className="pb-2">วันที่</th><th className="pb-2">ประเภท</th><th className="pb-2">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {done.map((r) => (
              <tr key={r.id} className="border-t border-line-soft">
                <td className="py-2">{r.requester!.name}</td>
                <td className="py-2">{formatDate(r.date)}</td>
                <td className="py-2">{TYPE_LABEL[r.type]}</td>
                <td className="py-2"><RequestBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
