"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/security";
import { TIME_RE, type CheckinPolicy } from "@/lib/settings";
import type { AutomationSettings } from "@/lib/automation";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/** Admin edits the check-in security policy (Master Data → นโยบายการเช็คอิน). */
export async function updateCheckinPolicy(input: CheckinPolicy): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user || session.user.role !== "ADMIN") return { ok: false, message: dict.actions.unauthorized };

  const retention = Math.round(Number(input.selfieRetentionDays));
  if (!Number.isFinite(retention) || retention < 7 || retention > 365) {
    return { ok: false, message: dict.actions.policy.invalidRetention };
  }
  const workStart = String(input.workStart ?? "").trim();
  const workEnd = String(input.workEnd ?? "").trim();
  const grace = Math.round(Number(input.lateGraceMinutes));
  if (!TIME_RE.test(workStart) || !TIME_RE.test(workEnd) || workEnd <= workStart) {
    return { ok: false, message: dict.actions.policy.invalidHours };
  }
  if (!Number.isFinite(grace) || grace < 0 || grace > 180) return { ok: false, message: dict.actions.policy.invalidGrace };
  const data = {
    requireBiometricCheckin: !!input.requireBiometricCheckin,
    requireSelfieCheckin: !!input.requireSelfieCheckin,
    deviceApprovalRequired: !!input.deviceApprovalRequired,
    selfieRetentionDays: retention,
    workStart,
    workEnd,
    lateGraceMinutes: grace,
  };
  await prisma.appSetting.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
  await logAudit({
    action: "POLICY_CHANGED",
    actorId: session.user.id,
    ip: getClientIp(),
    detail: `biometric=${data.requireBiometricCheckin} selfie=${data.requireSelfieCheckin} approval=${data.deviceApprovalRequired} retention=${data.selfieRetentionDays}d hours=${workStart}-${workEnd} grace=${grace}m`,
  });
  revalidatePath("/admin/master-data");
  revalidatePath("/checkin");
  return { ok: true, message: dict.actions.policy.saved };
}

/** Admin edits automatic reminders + PDPA retention (Master Data → การแจ้งเตือนอัตโนมัติ). */
export async function updateAutomationSettings(input: AutomationSettings): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user || session.user.role !== "ADMIN") return { ok: false, message: dict.actions.unauthorized };
  const t = dict.actions.automation;

  const int = (v: unknown) => Math.round(Number(v));
  const inMin = int(input.remindCheckinAfterMin);
  const outMin = int(input.remindCheckoutAfterMin);
  const days = int(input.pendingDigestDays);
  const keepAtt = int(input.attendanceRetentionMonths);
  const keepFiles = int(input.attachmentRetentionMonths);
  const weekdays = Array.from(new Set((input.remindWeekdays ?? []).map(int).filter((n) => n >= 0 && n <= 6))).sort();
  const digestTime = String(input.pendingDigestTime ?? "").trim();
  if (![inMin, outMin].every((n) => Number.isFinite(n) && n >= 0 && n <= 240)) return { ok: false, message: t.invalidMinutes };
  if (!Number.isFinite(days) || days < 1 || days > 30) return { ok: false, message: t.invalidDays };
  if (!TIME_RE.test(digestTime)) return { ok: false, message: t.invalidTime };
  // 0 = keep forever; otherwise at least a year for attendance (payroll/audit), 3 months for files.
  if (!Number.isFinite(keepAtt) || (keepAtt !== 0 && (keepAtt < 12 || keepAtt > 120))) return { ok: false, message: t.invalidAttendanceRetention };
  if (!Number.isFinite(keepFiles) || (keepFiles !== 0 && (keepFiles < 3 || keepFiles > 120))) return { ok: false, message: t.invalidFileRetention };

  const data = {
    remindCheckin: !!input.remindCheckin,
    remindCheckinAfterMin: inMin,
    remindCheckout: !!input.remindCheckout,
    remindCheckoutAfterMin: outMin,
    remindWeekdays: weekdays.join(","),
    pendingDigest: !!input.pendingDigest,
    pendingDigestDays: days,
    pendingDigestTime: digestTime,
    lessonPlanReminders: !!input.lessonPlanReminders,
    attendanceRetentionMonths: keepAtt,
    attachmentRetentionMonths: keepFiles,
  };
  await prisma.appSetting.upsert({ where: { id: "default" }, create: { id: "default", ...data }, update: data });
  await logAudit({
    action: "AUTOMATION_CHANGED",
    actorId: session.user.id,
    ip: getClientIp(),
    detail: `in=${data.remindCheckin ? `${inMin}m` : "off"} out=${data.remindCheckout ? `${outMin}m` : "off"} days=${data.remindWeekdays} digest=${data.pendingDigest ? `${days}d@${digestTime}` : "off"} lp=${data.lessonPlanReminders} keep=${keepAtt}mo files=${keepFiles}mo`,
  });
  revalidatePath("/admin/master-data");
  return { ok: true, message: dict.actions.policy.saved };
}
