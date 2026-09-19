"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getExpectedSite, isWithinSite } from "@/lib/geo";
import { todayAtMidnight } from "@/lib/date";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * FR-4 / site-per-teacher: check-in must happen at the site tied to *this
 * teacher's own schedule for today* — see getExpectedSite in src/lib/geo.ts
 * for why (each teacher can be scheduled at a different campus, so "inside
 * any registered location" is no longer the right check).
 */
export async function checkIn(lat: number, lng: number) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return { ok: false, message: dict.actions.pleaseSignIn };

  const expected = await getExpectedSite(session.user.id, "checkin");
  if (expected.kind === "no_schedule") return { ok: false, message: dict.actions.checkin.noScheduleToday };
  if (expected.kind === "no_location") {
    return { ok: false, message: dict.actions.checkin.roomNoLocation(expected.room.name) };
  }
  if (!isWithinSite(lat, lng, expected.site.campusLocation)) {
    return { ok: false, message: dict.actions.checkin.wrongSiteIn(expected.site.campusLocation.name) };
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

/** FR-4 / site-per-teacher: check-out — same per-teacher site check as check-in, but resolved against today's *last* class (see getExpectedSite). */
export async function checkOut(lat: number, lng: number) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return { ok: false, message: dict.actions.pleaseSignIn };

  const date = todayAtMidnight();
  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId: session.user.id, date } },
  });
  if (!existing?.checkinAt) return { ok: false, message: dict.actions.checkin.notCheckedInYet };
  if (existing.checkoutAt) return { ok: false, message: dict.actions.checkin.alreadyCheckedOut };

  const expected = await getExpectedSite(session.user.id, "checkout");
  if (expected.kind === "no_schedule") return { ok: false, message: dict.actions.checkin.noScheduleToday };
  if (expected.kind === "no_location") {
    return { ok: false, message: dict.actions.checkin.roomNoLocation(expected.room.name) };
  }
  if (!isWithinSite(lat, lng, expected.site.campusLocation)) {
    return { ok: false, message: dict.actions.checkin.wrongSiteOut(expected.site.campusLocation.name) };
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
