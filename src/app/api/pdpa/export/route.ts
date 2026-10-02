import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDPA right of access (ม.30): everything the system holds about one
 * person, as a JSON file. A member can export only their own data; an
 * Admin can export anyone's (?userId=). Files (lesson plans, leave
 * attachments) are listed with their metadata — they download separately
 * from the app; selfies are included as base64 because they exist only here.
 * Password hashes, device public keys and tokens are never exported.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  const asked = req.nextUrl.searchParams.get("userId");
  const isAdmin = session.user.role === "ADMIN";
  if (asked && asked !== session.user.id && !isAdmin) return new NextResponse("Forbidden", { status: 403 });
  const userId = asked || session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, username: true, email: true, role: true, isActive: true, createdAt: true, lastLoginAt: true,
      consentAt: true, consentVersion: true, passwordSetAt: true,
      department: { select: { name: true } },
      campusLocation: { select: { name: true } },
      extraSites: { select: { location: { select: { name: true } } } },
    },
  });
  if (!user) return new NextResponse("Not found", { status: 404 });

  const [attendance, leave, attest, plans, schedules, notifications, devices, push, issues, selfies, audit] = await Promise.all([
    prisma.attendance.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    prisma.leaveRequest.findMany({
      where: { requesterId: userId },
      orderBy: { startDate: "asc" },
      select: { id: true, type: true, startDate: true, endDate: true, halfDay: true, reason: true, status: true, decidedAt: true, cancelledAt: true, createdAt: true, attachmentName: true, attachmentMime: true, attachmentSize: true, approver: { select: { name: true } } },
    }),
    prisma.timeAttestation.findMany({ where: { requesterId: userId }, orderBy: { date: "asc" }, include: { approver: { select: { name: true } } } }),
    prisma.lessonPlan.findMany({
      where: { teacherId: userId },
      select: { id: true, fileName: true, mimeType: true, fileSize: true, status: true, reviewNote: true, submittedAt: true, decidedAt: true, course: { select: { code: true, name: true } }, semester: { select: { name: true } } },
    }),
    prisma.schedule.findMany({ where: { teacherId: userId }, select: { dayOfWeek: true, startTime: true, endTime: true, note: true, course: { select: { code: true, name: true } }, room: { select: { name: true, building: true } }, semester: { select: { name: true } } } }),
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { kind: true, params: true, createdAt: true, readAt: true } }),
    prisma.webauthnCredential.findMany({ where: { userId }, select: { label: true, deviceType: true, pending: true, createdAt: true, approvedAt: true, lastUsedAt: true } }),
    prisma.pushSubscription.findMany({ where: { userId }, select: { userAgent: true, locale: true, createdAt: true, lastUsedAt: true } }),
    prisma.issueReport.findMany({ where: { reporterId: userId }, select: { category: true, area: true, title: true, detail: true, status: true, adminNote: true, pageUrl: true, device: true, createdAt: true, attachmentName: true } }),
    prisma.selfie.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.auditLog.findMany({ where: { OR: [{ targetUserId: userId }, { actorId: userId }] }, orderBy: { at: "asc" }, select: { at: true, action: true, ip: true, device: true, detail: true } }),
  ]);

  const data = {
    exportedAt: new Date().toISOString(),
    exportedBy: session.user.id === userId ? "self" : "admin",
    note: "Personal data held by TeachSchedule for this person (PDPA). File contents of lesson plans and leave attachments are downloadable in the app; selfies are included below as base64 JPEG.",
    profile: {
      ...user,
      department: user.department?.name ?? null,
      primarySite: user.campusLocation?.name ?? null,
      extraSites: user.extraSites.map((x) => x.location.name),
      campusLocation: undefined,
    },
    attendance,
    leaveRequests: leave,
    timeAttestations: attest,
    lessonPlans: plans,
    schedule: schedules,
    notifications,
    devices,
    pushSubscriptions: push,
    issueReports: issues,
    selfies: selfies.map((s) => ({ id: s.id, kind: s.kind, createdAt: s.createdAt, mimeType: s.mimeType, base64: Buffer.from(s.data).toString("base64") })),
    securityLog: audit,
  };

  await logAudit({ action: "PDPA_EXPORT", actorId: session.user.id, targetUserId: userId, ip: getClientIp(), detail: session.user.id === userId ? "self" : "by admin" });
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `personal-data-${(user.username || user.id).replace(/[^\w.-]/g, "_")}-${stamp}.json`;
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
