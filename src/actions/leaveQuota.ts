"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LeaveType } from "@prisma/client";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * Admin sets how many days/year a leave type allows (0 = unlimited) — see
 * src/lib/leaveQuota.ts for how this is merged with the statutory defaults
 * and checked (non-blocking) against a teacher's usage.
 */
export async function updateLeaveQuota(type: LeaveType, daysPerYear: number): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user || session.user.role !== "ADMIN") {
    return { ok: false, message: dict.actions.unauthorized };
  }
  if (!Number.isInteger(daysPerYear) || daysPerYear < 0) {
    return { ok: false, message: dict.actions.leaveQuota.invalidDays };
  }

  await prisma.leaveQuota.upsert({
    where: { type },
    create: { type, daysPerYear },
    update: { daysPerYear },
  });

  revalidatePath("/admin/master-data");
  revalidatePath("/leave");
  return { ok: true, message: dict.actions.leaveQuota.updated(dict.leave.types[type], daysPerYear) };
}
