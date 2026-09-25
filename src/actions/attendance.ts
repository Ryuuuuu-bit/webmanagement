"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getExpectedSite, isWithinSite } from "@/lib/geo";
import { todayAtMidnight } from "@/lib/date";
import { verifyAssertion } from "@/lib/webauthn";
import { atTimeOfDay, getCheckinPolicy, getWorkHoursForUser } from "@/lib/settings";
import { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import { notifyAdmins } from "@/lib/notify";
import { getClientIp } from "@/lib/security";
import { cookies } from "next/headers";
import { PDPA_VERSION } from "@/lib/consent";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// Anti "buddy punching" (ฝากเช็คอิน/เช็คเอาต์แทนกัน): being logged in and
// standing in the right spot isn't proof that the person tapping the button
// is the account owner — a shared phone or a known password lets someone
// check a colleague in/out. With the (default) biometric policy ON, every
// check-in/out therefore requires a fresh Face ID / fingerprint from a
// registered, Admin-approved device — no password path, since a password is
// exactly what a colleague can be told. With the policy OFF the signed-in
// session itself is enough ("session" method — no extra prompt; client
// decision, the switch means exactly what it says). The selfie policy and
// shared-device detection still apply either way. See CheckinClient.tsx.
export type IdentityVerification =
  | { method: "webauthn"; assertion: AuthenticationResponseJSON }
  | { method: "session" };

export type CheckinExtras = {
  /** Random id kept in this browser's localStorage (see CheckinClient). */
  deviceId: string | null;
  /** JPEG data URL captured at the moment of tapping, when the selfie policy is on. */
  selfie: string | null;
};

type Fail = { ok: false; message: string };

/** The layout gates the UI on the PDPA notice; the actions that actually collect GPS/selfies must too (scripted calls bypass the UI). */
async function requireConsent(userId: string): Promise<Fail | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { consentVersion: true } });
  if (u?.consentVersion !== PDPA_VERSION) return { ok: false, message: getDictionary(getLocale()).actions.checkin.consentRequired };
  return null;
}

/** Client-supplied install id, falling back to the ts_did cookie so omitting it can't switch shared-device detection off. */
function resolveDeviceId(fromClient: string | null): string | null {
  if (fromClient) return fromClient.slice(0, 64);
  try {
    return cookies().get("ts_did")?.value?.slice(0, 64) ?? null;
  } catch {
    return null;
  }
}

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

  // "session": accepted only while the biometric policy is off.
  if (policy.requireBiometricCheckin) {
    return { ok: false, message: pending > 0 ? dict.actions.checkin.devicePending : dict.actions.checkin.noDevice };
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
 * True when this teacher has an APPROVED half-day PM leave for `date` — that
 * leave keeps the real check-in/out record (see decideLeave in
 * src/actions/leave.ts), so checking out before the site's workEnd on that
 * day is expected, not an "early checkout" worth flagging to Admin.
 * LeaveRequest.startDate is stored as a raw UTC-midnight parse of the
 * "YYYY-MM-DD" form input, not Bangkok-local midnight like Attendance.date —
 * normalizing with the same `setHours(0,0,0,0)` decideLeave uses before
 * writing LEAVE rows keeps the comparison correct either way.
 */
export async function hasApprovedPmHalfDayLeave(userId: string, date: Date): Promise<boolean> {
  const leaves = await prisma.leaveRequest.findMany({
    where: { requesterId: userId, status: "APPROVED", halfDay: "PM" },
    select: { startDate: true },
  });
  return leaves.some((r) => {
    const d = new Date(r.startDate);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === date.getTime();
  });
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
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
  const deviceId = resolveDeviceId(extras.deviceId);

  const consentFail = await requireConsent(userId);
  if (consentFail) return consentFail;
  const idFail = await verifyIdentity(userId, verification);
  if (idFail) return idFail;

  const date = todayAtMidnight();
  // One check-in per day: a second call (stale tab, scripted) must not
  // overwrite the first stamp, an admin edit or the day's status.
  const already = await prisma.attendance.findUnique({ where: { userId_date: { userId, date } }, select: { checkinAt: true, checkoutAt: true } });
  if (already?.checkinAt) return { ok: false, message: dict.actions.checkin.alreadyCheckedIn };
  // Checked out without ever checking in (forgot) — a check-in stamped
  // AFTER the check-out would be nonsense; the arrival time comes from a
  // check-in attestation instead.
  if (already?.checkoutAt) return { ok: false, message: dict.actions.checkin.checkinAfterCheckout };

  const expected = await getExpectedSite(userId);
  if (expected.kind === "no_site") return { ok: false, message: dict.actions.checkin.noSiteAssigned };
  if (!isWithinSite(lat, lng, expected.site)) {
    return { ok: false, message: dict.actions.checkin.wrongSiteIn(expected.site.name) };
  }

  const selfie = await storeSelfie(userId, "checkin", extras.selfie);
  if ("ok" in selfie) return selfie;

  const now = new Date();
  // Late = after the site's (or global) start time plus the grace window.
  const hours = await getWorkHoursForUser(userId);
  const cutoff = new Date(atTimeOfDay(date, hours.start).getTime() + hours.graceMinutes * 60_000);
  const status: "ON_TIME" | "LATE" = now <= cutoff ? "ON_TIME" : "LATE";
  const shared = await detectSharedDevice(userId, date, deviceId, ip);

  const evidence = {
    checkinAt: now,
    checkinLat: lat,
    checkinLng: lng,
    status,
    checkinMethod: verification.method,
    checkinDeviceId: deviceId,
    checkinSelfieId: selfie.id,
    ...(shared ? { flagSharedDevice: true } : {}),
  };
  // Atomic claim, same spirit as checkOut's guarded updateMany below — the
  // `already` read above is only a fast-path UX check and doesn't stop two
  // concurrent taps both passing it. Unlike checkOut, today's row may not
  // exist yet, so a single updateMany isn't enough: try the guarded update
  // first (covers a pre-existing row, e.g. an approved-leave LEAVE stub),
  // and only create when no row exists. If two requests race to create at
  // the same instant, the DB's unique (userId, date) constraint lets only
  // one create through; the loser retries the guarded update, which by then
  // sees the winner's checkinAt and correctly reports "already checked in".
  const openRow = { userId, date, checkinAt: null, checkoutAt: null };
  let claimed = (await prisma.attendance.updateMany({ where: openRow, data: evidence })).count > 0;
  if (!claimed) {
    try {
      await prisma.attendance.create({ data: { userId, date, ...evidence } });
      claimed = true;
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      claimed = (await prisma.attendance.updateMany({ where: openRow, data: evidence })).count > 0;
    }
  }
  if (!claimed) return { ok: false, message: dict.actions.checkin.alreadyCheckedIn };

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
  const deviceId = resolveDeviceId(extras.deviceId);

  const consentFail = await requireConsent(userId);
  if (consentFail) return consentFail;
  const idFail = await verifyIdentity(userId, verification);
  if (idFail) return idFail;

  const date = todayAtMidnight();
  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId, date } } });
  if (existing?.checkoutAt) return { ok: false, message: dict.actions.checkin.alreadyCheckedOut };
  // Client decision (2026-09-25): forgetting to check in must not also cost
  // the real, GPS/biometric-verified check-out. The check-out is recorded
  // as usual; the day stays status PENDING with no checkinAt (shown as
  // "awaiting check-in attestation") until a FORGOT_CHECKIN attestation is
  // approved, which fills checkinAt and sets ON_TIME/LATE.
  const missedCheckin = !existing?.checkinAt;

  const expected = await getExpectedSite(userId);
  if (expected.kind === "no_site") return { ok: false, message: dict.actions.checkin.noSiteAssigned };
  if (!isWithinSite(lat, lng, expected.site)) {
    return { ok: false, message: dict.actions.checkin.wrongSiteOut(expected.site.name) };
  }

  const selfie = await storeSelfie(userId, "checkout", extras.selfie);
  if ("ok" in selfie) return selfie;

  const now = new Date();
  const hours = await getWorkHoursForUser(userId);
  const onApprovedPmLeave = await hasApprovedPmHalfDayLeave(userId, date);
  const earlyCheckout = !onApprovedPmLeave && now < atTimeOfDay(date, hours.end);
  const shared = await detectSharedDevice(userId, date, deviceId, ip);
  const outData = {
    checkoutAt: now,
    checkoutLat: lat,
    checkoutLng: lng,
    checkoutMethod: verification.method,
    checkoutDeviceId: deviceId,
    checkoutSelfieId: selfie.id,
    earlyCheckout,
    ...(shared ? { flagSharedDevice: true } : {}),
  };
  // Atomic: only the first of two concurrent taps wins. Same claim → create
  // → retry shape as checkIn, since with a missed check-in there may be no
  // row for today yet.
  let claimed = (await prisma.attendance.updateMany({ where: { userId, date, checkoutAt: null }, data: outData })).count > 0;
  if (!claimed && !existing) {
    try {
      await prisma.attendance.create({ data: { userId, date, ...outData } });
      claimed = true;
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      claimed = (await prisma.attendance.updateMany({ where: { userId, date, checkoutAt: null }, data: outData })).count > 0;
    }
  }
  if (!claimed) return { ok: false, message: dict.actions.checkin.alreadyCheckedOut };

  revalidatePath("/checkin");
  revalidatePath("/dashboard");
  if (missedCheckin) return { ok: true, message: dict.actions.checkin.outSuccessNoCheckin, needsAttestation: true };
  return { ok: true, message: earlyCheckout ? dict.actions.checkin.outSuccessEarly(hours.end) : dict.actions.checkin.outSuccess };
}
