"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildRegistrationOptions, finishRegistration as finishRegistrationLib, buildAuthenticationOptions } from "@/lib/webauthn";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/security";

async function requireUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("Unauthorized");
  return session.user.id;
}

export type WebauthnCredentialRow = { id: string; label: string | null; createdAt: string; lastUsedAt: string | null };

/** For the check-in page: does this teacher have at least one registered device, and which ones. */
export async function listMyCredentials(): Promise<WebauthnCredentialRow[]> {
  const userId = await requireUserId();
  const rows = await prisma.webauthnCredential.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  });
  return rows.map((r: { id: string; label: string | null; createdAt: Date; lastUsedAt: Date | null }) => ({
    id: r.id,
    label: r.label,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));
}

/** Step 1 of registering this device's fingerprint/Face ID: get a WebAuthn challenge to hand to the browser. */
export async function startWebauthnRegistration() {
  const userId = await requireUserId();
  return buildRegistrationOptions(userId);
}

/** Step 2: verify what the browser/authenticator returned and store the new credential. */
export async function finishWebauthnRegistration(
  response: RegistrationResponseJSON,
  label: string
): Promise<{ ok: boolean; message: string }> {
  const userId = await requireUserId();
  const dict = getDictionary(getLocale());

  const result = await finishRegistrationLib(userId, response, label.trim() || null);
  if (!result.ok) {
    return {
      ok: false,
      message: result.reason === "challenge_expired" ? dict.actions.webauthn.challengeExpired : dict.actions.webauthn.verifyFailed,
    };
  }
  await logAudit({ action: "PASSKEY_REGISTERED", actorId: userId, targetUserId: userId, ip: getClientIp(), detail: label.trim() || null });
  revalidatePath("/checkin");
  return { ok: true, message: dict.actions.webauthn.registered };
}

/** Step 1 of verifying identity at check-in/out time: get a WebAuthn challenge scoped to this teacher's registered devices. */
export async function startWebauthnVerification() {
  const userId = await requireUserId();
  return buildAuthenticationOptions(userId);
}

/** A teacher removes one of their own registered devices (e.g. lost phone, or just tidying up). */
export async function deleteMyCredential(credentialDbId: string): Promise<{ ok: boolean; message: string }> {
  const userId = await requireUserId();
  const dict = getDictionary(getLocale());
  await prisma.webauthnCredential.deleteMany({ where: { id: credentialDbId, userId } });
  await logAudit({ action: "PASSKEY_REMOVED", actorId: userId, targetUserId: userId, ip: getClientIp() });
  revalidatePath("/checkin");
  return { ok: true, message: dict.actions.webauthn.deviceRemoved };
}

/**
 * Admin support action: clears every registered device for a teacher (e.g.
 * their phone broke/was lost and they can't pass the biometric check
 * anymore). They fall back to password-verified check-in/out until they
 * register a new device.
 */
export async function adminClearWebauthnCredentials(userId: string): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user || session.user.role !== "ADMIN") return { ok: false, message: dict.actions.pleaseSignIn };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: dict.actions.users.notFound };

  await prisma.webauthnCredential.deleteMany({ where: { userId } });
  await logAudit({ action: "PASSKEYS_CLEARED_BY_ADMIN", actorId: session.user.id, targetUserId: userId, ip: getClientIp() });
  revalidatePath("/admin/users");
  return { ok: true, message: dict.actions.webauthn.adminCleared(user.name) };
}
