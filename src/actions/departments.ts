"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/security";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

/** Master data (was hardcoded in prisma/seed.ts) — Admin manages it here instead, no code deploy needed. */
export async function createDepartment(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());

  const name = (formData.get("name") as string || "").trim();
  if (!name) return { ok: false, message: dict.actions.departments.fillRequired };

  const existing = await prisma.department.findUnique({ where: { name } });
  if (existing) return { ok: false, message: dict.actions.departments.exists };

  await prisma.department.create({ data: { name } });
  await logAudit({ action: "DEPARTMENT_CHANGED", actorId: session.user.id, ip: getClientIp(), detail: `created "${name}"` });
  revalidatePath("/admin/master-data");
  return { ok: true, message: dict.actions.departments.created(name) };
}

export async function updateDepartment(
  id: string,
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());

  const name = (formData.get("name") as string || "").trim();
  if (!name) return { ok: false, message: dict.actions.departments.fillRequired };

  const conflict = await prisma.department.findFirst({ where: { name, NOT: { id } } });
  if (conflict) return { ok: false, message: dict.actions.departments.existsOther };

  await prisma.department.update({ where: { id }, data: { name } });
  await logAudit({ action: "DEPARTMENT_CHANGED", actorId: session.user.id, ip: getClientIp(), detail: `updated to "${name}"` });
  revalidatePath("/admin/master-data");
  return { ok: true, message: dict.actions.departments.updated(name) };
}

/** Blocked if any user is still assigned — avoids silently orphaning their department. */
export async function deleteDepartment(id: string): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());

  const dept = await prisma.department.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!dept) return { ok: false, message: dict.actions.departments.notFound };
  if (dept._count!.users > 0) {
    return { ok: false, message: dict.actions.departments.inUse(dept._count!.users) };
  }

  await prisma.department.delete({ where: { id } });
  await logAudit({ action: "DEPARTMENT_CHANGED", actorId: session.user.id, ip: getClientIp(), detail: `deleted "${dept.name}"` });
  revalidatePath("/admin/master-data");
  return { ok: true, message: dict.actions.departments.deleted(dept.name) };
}
