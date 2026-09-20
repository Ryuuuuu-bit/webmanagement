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
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// Anti "buddy punching" (ฝากเช็คอิน/เช็คเอาต์แทนกัน): being logged in and
// standing in the right spot isn't proof that the person tapping the button
// is the account owner — a shared phone or a known password lets someone
// check a colleague in/out. Both checkIn and checkOut now require a fresh
// identity check on every single call: the teacher's own device biometric
// (fingerprint/Face ID via WebAuthn) if they've registered one, or their
// account password as a fallback for a device that can't do platform
// biometrics. See src/lib/webauthn.ts and src/components/CheckinClient.tsx.
export type IdentityVerification =
  | { method: "webauthn"; assertion: AuthenticationResponseJSON }
  | { method: "password"; password: string };

async function verifyIdentity(userId: string, verification: IdentityVerification): Promise<boolean> {
  if (verification.method === "webauthn") {
    return verifyAssertion(userId, verification.assertion);
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) return false;
  return bcrypt.compare(verification.password, user.passwordHash);
}

/**
 * FR-4 / site-per-teacher: check-in must happen at *this teacher's own
 * assigned site* — see getExpectedSite in src/lib/geo.ts (each teacher is
 * permanently stationed at one site, so "inside any registered location" is
 * not the right check).
 */
export async function checkIn(lat: number, lng: number, verification: IdentityVerification) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return { ok: false, message: dict.actions.pleaseSignIn };

  if (!(await verifyIdentity(session.user.id, verification))) {
    return { ok: false, message: dict.actions.checkin.identityFailed };
  }

  const expected = await getExpectedSite(session.user.id);
  if (expected.kind === "no_site") return { ok: false, message: dict.actions.checkin.noSiteAssigned };
  if (!isWithinSite(lat, lng, expected.site)) {
    return { ok: false, message: dict.actions.checkin.wrongSiteIn(expected.site.name) };
  }

  const date = todayAtMidnight();
  const now = new Date();
  const cutoff = new Date(date);
  cutoff.setHours(8, 30, 0, 0);
  const status = now <= cutoff ? "ON_TIME" : "LATE";

  await prisma.attendance.upsert({
    where: { userId_date: { userId: session.user.id, date } },
    create: { userId: session.user.id, date, checkinAt: now, checkinLat: lat, checkinLng: lng, status },
    update: { checkinAt: now, checkinLat: lat, checkinLng: lng, status },
  });

  revalidatePath("/checkin");
  revalidatePath("/dashboard");
  return { ok: true, message: status === "LATE" ? dict.actions.checkin.inSuccessLate : dict.actions.checkin.inSuccessOnTime };
}

/** FR-4 / site-per-teacher: check-out — same per-teacher assigned-site check as check-in (see getExpectedSite). */
export async function checkOut(lat: number, lng: number, verification: IdentityVerification) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return { ok: false, message: dict.actions.pleaseSignIn };

  if (!(await verifyIdentity(session.user.id, verification))) {
    return { ok: false, message: dict.actions.checkin.identityFailed };
  }

  const date = todayAtMidnight();
  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId: session.user.id, date } },
  });
  if (!existing?.checkinAt) return { ok: false, message: dict.actions.checkin.notCheckedInYet };
  if (existing.checkoutAt) return { ok: false, message: dict.actions.checkin.alreadyCheckedOut };

  const expected = await getExpectedSite(session.user.id);
  if (expected.kind === "no_site") return { ok: false, message: dict.actions.checkin.noSiteAssigned };
  if (!isWithinSite(lat, lng, expected.site)) {
    return { ok: false, message: dict.actions.checkin.wrongSiteOut(expected.site.name) };
  }

  const now = new Date();
  await prisma.attendance.update({
    where: { userId_date: { userId: session.user.id, date } },
    data: { checkoutAt: now, checkoutLat: lat, checkoutLng: lng },
  });

  revalidatePath("/checkin");
  revalidatePath("/dashboard");
  return { ok: true, message: dict.actions.checkin.outSuccess };
}
