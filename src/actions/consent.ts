"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/security";
import { PDPA_VERSION } from "@/lib/consent";

/** Records that the signed-in person accepted the current privacy notice. */
export async function acceptConsent(): Promise<{ ok: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false };
  await prisma.user.update({ where: { id: session.user.id }, data: { consentAt: new Date(), consentVersion: PDPA_VERSION } });
  await logAudit({ action: "CONSENT_GIVEN", actorId: session.user.id, targetUserId: session.user.id, ip: getClientIp(), detail: PDPA_VERSION });
  return { ok: true };
}
