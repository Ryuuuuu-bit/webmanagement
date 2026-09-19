import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requestAttestation, decideAttestation } from "@/actions/attest";
import { RequestBadge } from "@/components/StatusBadge";
import DecisionButtons from "@/components/DecisionButtons";
import { formatDate } from "@/lib/date";

const TYPE_LABEL: Record<string, string> = {
  FORGOT_CHECKIN: "ลืมเช็คอิน",
  FORGOT_CHECKOUT: "ลืมเช็คเอาต์",
  FORGOT_BOTH: "ลืมทั้งสองอย่าง",
};

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
        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold">ขอรับรองเวลา</h2>
          <p className="mb-3 text-sm text-black/50">
            ใช้เมื่อลืมเช็คอินหรือเช็คเอาต์ในวันใดวันหนึ่ง — คำขอจะถูกส่งให้ Admin/Senior อนุมัติ
            และบันทึกแยกจากเวลาที่เช็คอินจริงผ่าน GPS (FR-13)
          </p>
          <form action={requestAttestation} className="flex flex-col gap-3.5">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              <Field label="วันที่"><input type="date" name="date" required className="input" /></Field>
              <Field label="ประเภท">
                <select name="type" className="input">
                  <option value="FORGOT_CHECKIN">ลืมเช็คอิน</option>
                  <option value="FORGOT_CHECKOUT">ลืมเช็คเอาต์</option>
                  <option value="FORGOT_BOTH">ลืมทั้งสองอย่าง</option>
                </select>
              </Field>
              <Field label="เวลาที่ขอรับรอง"><input type="time" name="time" required className="input" /></Field>
            </div>
            <Field label="เหตุผล">
              <textarea name="reason" required className="input min-h-[70px]" placeholder="เช่น มือถือแบตหมด, สัญญาณ GPS ขัดข้อง" />
            </Field>
            <button type="submit" className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
              ส่งคำขอรับรองเวลา
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold">ประวัติคำขอของฉัน</h2>
          {mine.length === 0 ? (
            <p className="mt-2 text-sm text-black/50">ยังไม่มีคำขอรับรองเวลา</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-black/40">
                  <th className="pb-2">วันที่</th><th className="pb-2">ประเภท</th><th className="pb-2">เวลาที่ขอ</th><th className="pb-2">เหตุผล</th><th className="pb-2">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((r) => (
                  <tr key={r.id} className="border-t border-black/5">
                    <td className="py-2">{formatDate(r.date)}</td>
                    <td className="py-2">{TYPE_LABEL[r.type]}</td>
                    <td className="py-2">{r.requestedTime} น.</td>
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
      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold">คำขอรับรองเวลาที่รออนุมัติ</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-black/50">ไม่มีคำขอค้างอนุมัติ</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-black/40">
                <th className="pb-2">อาจารย์</th><th className="pb-2">วันที่</th><th className="pb-2">ประเภท</th><th className="pb-2">เวลาที่ขอ</th><th className="pb-2">เหตุผล</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id} className="border-t border-black/5">
                  <td className="py-2">{r.requester!.name}</td>
                  <td className="py-2">{formatDate(r.date)}</td>
                  <td className="py-2">{TYPE_LABEL[r.type]}</td>
                  <td className="py-2">{r.requestedTime} น.</td>
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

      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold">ประวัติที่ดำเนินการแล้ว</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-black/40">
              <th className="pb-2">อาจารย์</th><th className="pb-2">วันที่</th><th className="pb-2">ประเภท</th><th className="pb-2">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {done.map((r) => (
              <tr key={r.id} className="border-t border-black/5">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
