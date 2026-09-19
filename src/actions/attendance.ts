"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isWithinAnyCampus } from "@/lib/geo";
import { todayAtMidnight } from "@/lib/date";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/** FR-4: check-in — must be inside a registered campus location (geofence). */
export async function checkIn(lat: number, lng: number) {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return { ok: false, message: dict.actions.pleaseSignIn };

  const within = await isWithinAnyCampus(lat, lng);
  if (!within) return { ok: false, message: dict.actions.checkin.outsideCampusIn };

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

/** FR-4: check-out — also must be inside a registered campus location. */
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

  const within = await isWithinAnyCampus(lat, lng);
  if (!within) return { ok: false, message: dict.actions.checkin.outsideCampusOut };

  const now = new Date();
  await prisma.attendance.update({
    where: { userId_date: { userId: session.user.id, date } },
    data: { checkoutAt: now, checkoutLat: lat, checkoutLng: lng },
  });

  revalidatePath("/checkin");
  revalidatePath("/dashboard");
  return { ok: true, message: dict.actions.checkin.outSuccess };
}
