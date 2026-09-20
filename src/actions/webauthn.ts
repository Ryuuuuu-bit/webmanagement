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
import { getCheckinPolicy } from "@/lib/settings";

// One registered device per teacher — a second one is exactly what a
// colleague's phone registered under your name would look like. Replacing
// a phone means removing the old device first (or Admin clearing it), which
// is itself audited.
const MAX_DEVICES_PER_USER = 1;
// A device registered right after redeeming an Admin-issued enrollment QR
// counts as Admin-approved (the QR was handed over in person).
const ENROLLMENT_GRACE_MS = 15 * 60 * 1000;

async function requireUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error("Unauthorized");
  return session.user.id;
}

export type WebauthnCredentialRow = { id: string; label: string | null; createdAt: string; lastUsedAt: string | null; pending: boolean };

/** For the check-in page: does this teacher have at least one registered device, and which ones. */
export async function listMyCredentials(): Promise<WebauthnCredentialRow[]> {
  const userId = await requireUserId();
  const rows = await prisma.webauthnCredential.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, pending: true },
  });
  return rows.map((r: { id: string; label: string | null; createdAt: Date; lastUsedAt: Date | null; pending: boolean }) => ({
    id: r.id,
    label: r.label,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    pending: r.pending,
  }));
}

/** True if this user redeemed an enrollment QR in the last few minutes (see ENROLLMENT_GRACE_MS). */
async function recentlyEnrolled(userId: string) {
  const row = await prisma.enrollmentToken.findFirst({
    where: { userId, usedAt: { gt: new Date(Date.now() - ENROLLMENT_GRACE_MS) } },
    select: { id: true },
  });
  return !!row;
}

/** Step 1 of registering this device's fingerprint/Face ID: get a WebAuthn challenge to hand to the browser. */
export async function startWebauthnRegistration() {
  const userId = await requireUserId();
  const dict = getDictionary(getLocale());
  const viaEnrollment = await recentlyEnrolled(userId);
  const existing = await prisma.webauthnCredential.count({ where: { userId } });
  // An enrollment QR means "this is my (new) phone" — it replaces whatever
  // was registered before. Self-registration is capped instead.
  if (existing >= MAX_DEVICES_PER_USER && !viaEnrollment) {
    throw new Error(dict.actions.webauthn.deviceLimit);
  }
  if (viaEnrollment && existing > 0) {
    // Fresh Admin-issued QR: the new phone replaces the old registration.
    // Cleared here (not only on finish) so the same phone can re-enrol —
    // WebAuthn refuses to re-register an authenticator that's still listed.
    await prisma.webauthnCredential.deleteMany({ where: { userId } });
  }
  return buildRegistrationOptions(userId);
}

/** Step 2: verify what the browser/authenticator returned and store the new credential. */
export async function finishWebauthnRegistration(
  response: RegistrationResponseJSON,
  label: string
): Promise<{ ok: boolean; message: string }> {
  const userId = await requireUserId();
  const dict = getDictionary(getLocale());
  const [policy, viaEnrollment] = await Promise.all([getCheckinPolicy(), recentlyEnrolled(userId)]);

  const existing = await prisma.webauthnCredential.count({ where: { userId } });
  if (existing >= MAX_DEVICES_PER_USER && !viaEnrollment) {
    return { ok: false, message: dict.actions.webauthn.deviceLimit };
  }
  if (viaEnrollment && existing > 0) {
    // Normally already cleared in startWebauthnRegistration; kept as a guard.
    await prisma.webauthnCredential.deleteMany({ where: { userId } });
  }

  const pending = policy.deviceApprovalRequired && !viaEnrollment;
  const result = await finishRegistrationLib(userId, response, label.trim() || null, { pending });
  if (!result.ok) {
    return {
      ok: false,
      message: result.reason === "challenge_expired" ? dict.actions.webauthn.challengeExpired : dict.actions.webauthn.verifyFailed,
    };
  }
  await logAudit({
    action: "PASSKEY_REGISTERED",
    actorId: userId,
    targetUserId: userId,
    ip: getClientIp(),
    detail: `${label.trim() || "-"}${pending ? " (pending approval)" : viaEnrollment ? " (via enrollment QR)" : ""}`,
  });
  revalidatePath("/checkin");
  return { ok: true, message: pending ? dict.actions.webauthn.registeredPending : dict.actions.webauthn.registered };
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

export type PendingDeviceRow = { id: string; userId: string; userName: string; label: string | null; createdAt: string };

/** Admin: devices waiting for approval (policy deviceApprovalRequired). */
export async function listPendingCredentials(): Promise<PendingDeviceRow[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return [];
  const rows = await prisma.webauthnCredential.findMany({
    where: { pending: true },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r: { id: string; userId: string; user: { name: string }; label: string | null; createdAt: Date }) => ({
    id: r.id,
    userId: r.userId,
    userName: r.user.name,
    label: r.label,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Admin approves (or rejects = deletes) a pending device. */
export async function decidePendingCredential(credentialDbId: string, approve: boolean): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user || session.user.role !== "ADMIN") return { ok: false, message: dict.actions.unauthorized };

  const row = await prisma.webauthnCredential.findUnique({ where: { id: credentialDbId }, include: { user: { select: { name: true } } } });
  if (!row || !row.pending) return { ok: false, message: dict.actions.webauthn.pendingNotFound };

  if (approve) {
    await prisma.webauthnCredential.update({
      where: { id: credentialDbId },
      data: { pending: false, approvedById: session.user.id, approvedAt: new Date() },
    });
  } else {
    await prisma.webauthnCredential.delete({ where: { id: credentialDbId } });
  }
  await logAudit({
    action: approve ? "DEVICE_APPROVED" : "DEVICE_REJECTED",
    actorId: session.user.id,
    targetUserId: row.userId,
    ip: getClientIp(),
    detail: row.label,
  });
  revalidatePath("/checkin");
  revalidatePath("/admin/users");
  return { ok: true, message: approve ? dict.actions.webauthn.deviceApproved(row.user.name) : dict.actions.webauthn.deviceRejected(row.user.name) };
}
