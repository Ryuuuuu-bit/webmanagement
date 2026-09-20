"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/security";
import { TIME_RE, type CheckinPolicy } from "@/lib/settings";
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
