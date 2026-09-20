import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { deleteRecord, clearRecords } from "@/actions/records";
import UserHistoryClient from "@/components/UserHistoryClient";

export const dynamic = "force-dynamic";

/**
 * Admin: one member's full transaction history with per-row and per-section
 * delete (client request). Everything is serialised to plain strings here;
 * the client component only renders and calls the two actions.
 */
export default async function UserHistoryPage({ params }: { params: { id: string } }) {
  const session = await requireUser();
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  const locale = getLocale();
  const dict = getDictionary(locale);

  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const user = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, name: true, username: true } });
  if (!user) notFound();

  const [attendance, leave, attest, lessonPlans] = await Promise.all([
    prisma.attendance.findMany({ where: { userId: user.id }, orderBy: { date: "desc" }, take: 200 }),
    prisma.leaveRequest.findMany({
      where: { requesterId: user.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, type: true, startDate: true, endDate: true, reason: true, status: true, createdAt: true },
    }),
    prisma.timeAttestation.findMany({ where: { requesterId: user.id }, orderBy: { createdAt: "desc" }, take: 200 }),
    // select, not include — never pull the stored file bytes just to list rows.
    prisma.lessonPlan.findMany({
      where: { teacherId: user.id },
      select: { id: true, fileName: true, fileSize: true, status: true, submittedAt: true, course: { select: { code: true, name: true } } },
      orderBy: { submittedAt: "desc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/admin/users" className="text-sm text-brand-ink hover:underline">
          {dict.history.back}
        </Link>
        <h1 className="mt-1 text-lg font-bold">{dict.history.title(user.name)}</h1>
        <p className="text-sm text-muted">
          {user.username && <span className="mr-2 font-mono text-xs text-faint">{user.username}</span>}
          {dict.history.hint}
        </p>
      </div>
      <UserHistoryClient
        userId={user.id}
        userName={user.name}
        attendance={attendance.map((a) => ({
          id: a.id,
          date: a.date.toISOString(),
          dayKey: dayKey(a.date),
          checkinAt: a.checkinAt?.toISOString() ?? null,
          checkoutAt: a.checkoutAt?.toISOString() ?? null,
          status: a.status,
          attestedCheckin: a.attestedCheckin,
          attestedCheckout: a.attestedCheckout,
          checkinMethod: a.checkinMethod,
          checkoutMethod: a.checkoutMethod,
          flagSharedDevice: a.flagSharedDevice,
          checkinSelfieId: a.checkinSelfieId,
          checkoutSelfieId: a.checkoutSelfieId,
        }))}
        leave={leave.map((l) => ({
          id: l.id,
          type: l.type,
          dayKey: dayKey(l.startDate),
          startDate: l.startDate.toISOString(),
          endDate: l.endDate.toISOString(),
          reason: l.reason,
          status: l.status,
          createdAt: l.createdAt.toISOString(),
        }))}
        attest={attest.map((t) => ({
          id: t.id,
          type: t.type,
          dayKey: dayKey(t.date),
          date: t.date.toISOString(),
          requestedTime: t.requestedTime,
          requestedCheckoutTime: t.requestedCheckoutTime,
          reason: t.reason,
          status: t.status,
        }))}
        lessonPlans={lessonPlans.map((p) => ({
          id: p.id,
          dayKey: dayKey(p.submittedAt),
          courseCode: p.course?.code ?? "-",
          courseName: p.course?.name ?? "-",
          fileName: p.fileName,
          fileSize: p.fileSize,
          status: p.status,
          submittedAt: p.submittedAt.toISOString(),
        }))}
        deleteRecord={deleteRecord}
        clearRecords={clearRecords}
      />
    </div>
  );
}
