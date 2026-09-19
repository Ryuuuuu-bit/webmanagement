"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isWithinAnyCampus } from "@/lib/geo";
import { todayAtMidnight } from "@/lib/date";

/** FR-4: check-in — must be inside a registered campus location (geofence). */
export async function checkIn(lat: number, lng: number) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false, message: "กรุณาเข้าสู่ระบบ" };

  const within = await isWithinAnyCampus(lat, lng);
  if (!within) return { ok: false, message: "เช็คอินไม่สำเร็จ — อยู่นอกพื้นที่มหาวิทยาลัย" };

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
  return { ok: true, message: status === "LATE" ? "เช็คอินสำเร็จ — บันทึกว่ามาสาย" : "เช็คอินสำเร็จ — ตรงเวลา" };
}

/** FR-4: check-out — also must be inside a registered campus location. */
export async function checkOut(lat: number, lng: number) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { ok: false, message: "กรุณาเข้าสู่ระบบ" };

  const date = todayAtMidnight();
  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId: session.user.id, date } },
  });
  if (!existing?.checkinAt) return { ok: false, message: "ยังไม่ได้เช็คอินวันนี้" };
  if (existing.checkoutAt) return { ok: false, message: "เช็คเอาต์ไปแล้ววันนี้" };

  const within = await isWithinAnyCampus(lat, lng);
  if (!within) return { ok: false, message: "เช็คเอาต์ไม่สำเร็จ — อยู่นอกพื้นที่มหาวิทยาลัย" };

  const now = new Date();
  await prisma.attendance.update({
    where: { userId_date: { userId: session.user.id, date } },
    data: { checkoutAt: now, checkoutLat: lat, checkoutLng: lng },
  });

  revalidatePath("/checkin");
  revalidatePath("/dashboard");
  return { ok: true, message: "เช็คเอาต์สำเร็จ" };
}
