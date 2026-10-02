"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { parseGradeLevels } from "@/lib/grades";

/** Admin sets which grade bands a teacher can teach (used to match substitutes). */
export async function updateUserGradeLevels(userId: string, levels: string[]): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  const dict = getDictionary(getLocale());
  const gradeLevels = parseGradeLevels(Array.isArray(levels) ? levels : []);
  const res = await prisma.user.updateMany({ where: { id: userId }, data: { gradeLevels } });
  if (res.count === 0) return { ok: false, message: dict.actions.users.notFound };
  revalidatePath("/substitutes");
  return { ok: true, message: dict.substitutes.gradesSaved };
}
