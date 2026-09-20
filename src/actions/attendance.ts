"use server";

import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getExpectedSite, isWithinSite } from "@/lib/geo";
import { todayAtMidnight } from "@/lib/date";
import { verifyAssertion } from "@/lib/webauthn";
import { getCheckinPolicy } from "@/lib/settings";
import { logAudit } from "@/lib/audit";
import { notifyAdmins } from "@/lib/notify";
import { getClientIp } from "@/lib/security";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// Anti "buddy punching" (ฝากเช็คอิน/เช็คเอาต์แทนกัน): being logged in and
// standing in the right spot isn't proof that the person tapping the button
// is the account owner — a shared phone or a known password lets someone
// check a colleague in/out. Every check-in/out therefore requires a fresh
// identity check. With the (default) biometric policy on, ONLY a registered
// and Admin-approved device's Face ID / fingerprint is accepted — there is
// no password path at all, since a password is exactly what a colleague can
// be told. With the policy off, a password is accepted only for accounts
// that have no registered device (having one means you must use it).
// On top of that, the selfie policy stores a photo of whoever tapped, and
// the same browser installation being used for two different teachers on
// one day is flagged for Admin. See src/components/CheckinClient.tsx.
export type IdentityVerification =
  | { method: "webauthn"; assertion: AuthenticationResponseJSON }
  | { method: "password"; password: string };

export type CheckinExtras = {
  /** Random id kept in this browser's localStorage (see CheckinClient). */
  deviceId: string | null;
  /** JPEG data URL captured at the moment of tapping, when the selfie policy is on. */
  selfie: string | null;
};

type Fail = { ok: false; message: string };

async function verifyIdentity(userId: string, verification: IdentityVerification): Promise<Fail | null> {
  const dict = getDictionary(getLocale());
  const policy = await getCheckinPolicy();
  const approved = await prisma.webauthnCredential.count({ where: { userId, pending: false } });
  const pending = approved === 0 ? await prisma.webauthnCredential.count({ where: { userId, pending: true } }) : 0;

  if (verification.method === "webauthn") {
    if (approved === 0) {
      return { ok: false, message: pending > 0 ? dict.actions.checkin.devicePending : dict.actions.checkin.noDevice };
    }
    return (await verifyAssertion(userId, verification.assertion)) ? null : { ok: false, message: dict.actions.checkin.identityFailed };
  }

  // Password path — only when the biometric policy is off AND the account
  // has no device (approved or pending) to use instead.
  if (policy.requireBiometricCheckin) {
    return { ok: false, message: pending > 0 ? dict.actions.checkin.devicePending : dict.actions.checkin.noDevice };
  }
  if (approved > 0 || pending > 0) return { ok: false, message: dict.actions.checkin.mustUseDevice };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await bcrypt.compare(verification.password, user.passwordHash))) {
    return { ok: false, message: dict.actions.checkin.identityFailed };
  }
  return null;
}

const SELFIE_MAX_BYTES = 400 * 1024;

/** Decodes and stores the selfie; returns its id, or an error when the policy demands one and it's missing/invalid. */
async function storeSelfie(userId: string, kind: "checkin" | "checkout", dataUrl: string | null): Promise<{ id: string | null } | Fail> {
  const dict = getDictionary(getLocale());
  const policy = await getCheckinPolicy();
  if (!policy.requireSelfieCheckin) return { id: null };
  if (!dataUrl) return { ok: false, message: dict.actions.checkin.selfieRequired };
  const m = /^data:(image\/jpeg|image\/png|image\/webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return { ok: false, message: dict.actions.checkin.selfieInvalid };
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length < 1000 || bytes.length > SELFIE_MAX_BYTES) return { ok: false, message: dict.actions.checkin.selfieInvalid };
  const row = await prisma.selfie.create({ data: { userId, kind, data: bytes, mimeType: m[1] } });
  // Retention: prune old selfies opportunistically (cheap indexed delete).
  const cutoff = new Date(Date.now() - policy.selfieRetentionDays * 86400000);
  prisma.selfie.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => {});
  return { id: row.id };
}

/**
 * The same browser installation tapping check-in/out for two different
 * teachers on the same day is the signature of a shared phone. Flags both
 * rows and writes an audit entry; never blocks (Admin decides).
 */
async function detectSharedDevice(userId: string, date: Date, deviceId: string | null, ip: string) {
  if (!deviceId) return false;
  const others = await prisma.attendance.findMany({
    where: {
      date,
      userId: { not: userId },
      OR: [{ checkinDeviceId: deviceId }, { checkoutDeviceId: deviceId }],
    },
    select: { id: true, userId: true },
  });
  if (others.length === 0) return false;
  await prisma.attendance.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { flagSharedDevice: true } });
  await logAudit({
    action: "SHARED_DEVICE_DETECTED",
    actorId: userId,
    targetUserId: userId,
    ip,
    detail: `same device as ${others.map((o) => o.userId).join(", ")}`,
  });
  const people = await prisma.user.findMany({
    where: { id: { in: [userId, ...others.map((o) => o.userId)] } },
    select: { id: true, name: true },
  });
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "-";
  await notifyAdmins(
    "SHARED_DEVICE_DETECTED",
    { userName: nameOf(userId), otherNames: Array.from(new Set(others.map((o) => nameOf(o.userId)))).join(", "), date: date.toISOString() },
    "/checkin"
  );
  return true;
}

/**
 * FR-4 / site-per-teacher: check-in must happen at *this teacher's own
 * assigned site* — see getExpectedSite in src/lib/geo.ts (each teacher is
 * permanently stationed at one site, so "inside any registered location" is
 * not the right check).
 */
export async function checkIn(lat: number, lng: number, verification: IdentityVerification, extras: CheckinExtras) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return { ok: false, message: dict.actions.pleaseSignIn };
  const userId = session.user.id;
  const ip = getClientIp();

  const idFail = await verifyIdentity(userId, verification);
  if (idFail) return idFail;

  const expected = await getExpectedSite(userId);
  if (expected.kind === "no_site") return { ok: false, message: dict.actions.checkin.noSiteAssigned };
  if (!isWithinSite(lat, lng, expected.site)) {
    return { ok: false, message: dict.actions.checkin.wrongSiteIn(expected.site.name) };
  }

  const selfie = await storeSelfie(userId, "checkin", extras.selfie);
  if ("ok" in selfie) return selfie;

  const date = todayAtMidnight();
  const now = new Date();
  const cutoff = new Date(date);
  cutoff.setHours(8, 30, 0, 0);
  const status = now <= cutoff ? "ON_TIME" : "LATE";
  const shared = await detectSharedDevice(userId, date, extras.deviceId, ip);

  const evidence = {
    checkinMethod: verification.method,
    checkinDeviceId: extras.deviceId,
    checkinSelfieId: selfie.id,
    ...(shared ? { flagSharedDevice: true } : {}),
  };
  await prisma.attendance.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, checkinAt: now, checkinLat: lat, checkinLng: lng, status, ...evidence },
    update: { checkinAt: now, checkinLat: lat, checkinLng: lng, status, ...evidence },
  });

  revalidatePath("/checkin");
  revalidatePath("/dashboard");
  return { ok: true, message: status === "LATE" ? dict.actions.checkin.inSuccessLate : dict.actions.checkin.inSuccessOnTime };
}

/** FR-4 / site-per-teacher: check-out — same per-teacher assigned-site check as check-in (see getExpectedSite). */
export async function checkOut(lat: number, lng: number, verification: IdentityVerification, extras: CheckinExtras) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return { ok: false, message: dict.actions.pleaseSignIn };
  const userId = session.user.id;
  const ip = getClientIp();

  const idFail = await verifyIdentity(userId, verification);
  if (idFail) return idFail;

  const date = todayAtMidnight();
  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId, date } } });
  if (!existing?.checkinAt) return { ok: false, message: dict.actions.checkin.notCheckedInYet };
  if (existing.checkoutAt) return { ok: false, message: dict.actions.checkin.alreadyCheckedOut };

  const expected = await getExpectedSite(userId);
  if (expected.kind === "no_site") return { ok: false, message: dict.actions.checkin.noSiteAssigned };
  if (!isWithinSite(lat, lng, expected.site)) {
    return { ok: false, message: dict.actions.checkin.wrongSiteOut(expected.site.name) };
  }

  const selfie = await storeSelfie(userId, "checkout", extras.selfie);
  if ("ok" in selfie) return selfie;

  const now = new Date();
  const shared = await detectSharedDevice(userId, date, extras.deviceId, ip);
  await prisma.attendance.update({
    where: { userId_date: { userId, date } },
    data: {
      checkoutAt: now,
      checkoutLat: lat,
      checkoutLng: lng,
      checkoutMethod: verification.method,
      checkoutDeviceId: extras.deviceId,
      checkoutSelfieId: selfie.id,
      ...(shared ? { flagSharedDevice: true } : {}),
    },
  });

  revalidatePath("/checkin");
  revalidatePath("/dashboard");
  return { ok: true, message: dict.actions.checkin.outSuccess };
}
