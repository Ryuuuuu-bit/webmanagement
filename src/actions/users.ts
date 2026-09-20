"use server";

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

/** Random, readable temporary password (avoids ambiguous chars like 0/O, 1/l/I). */
function generateTempPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Admin-created accounts (no self-registration): the admin enters name/email
 * and picks a role/department, the system generates a one-time temporary
 * password shown once on screen, and the account must change it on first login.
 */
export async function createUser(
  _prev: { ok: boolean; message: string; tempPassword?: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string; tempPassword?: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const name = (formData.get("name") as string || "").trim();
  const email = (formData.get("email") as string || "").trim().toLowerCase();
  const role = (formData.get("role") as string || "MEMBER") as Role;
  const departmentId = (formData.get("departmentId") as string) || null;
  const campusLocationId = (formData.get("campusLocationId") as string) || null;

  if (!name || !email) {
    return { ok: false, message: dict.actions.users.fillRequired };
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, message: dict.actions.users.invalidEmail };
  }
  if (role !== "ADMIN" && role !== "MEMBER") {
    return { ok: false, message: dict.actions.users.invalidRole };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, message: dict.actions.users.emailExists };
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role,
      departmentId: departmentId || undefined,
      campusLocationId: campusLocationId || undefined,
      mustChangePassword: true,
    },
  });

  revalidatePath("/admin/users");
  return {
    ok: true,
    message: dict.actions.users.created(name),
    tempPassword,
  };
}

/**
 * Admin resets an existing user's password (also doubles as "forgot password"
 * for this closed system — no email needed, admin just regenerates it).
 */
export async function resetUserPassword(
  userId: string
): Promise<{ ok: boolean; message: string; tempPassword?: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: dict.actions.users.notFound };

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  await prisma.user.update({
    where: { id: userId },
    // Bump tokenVersion so any active session this user has open right now
    // is rejected on its next request, instead of staying valid until it
    // naturally expires.
    data: { passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 } },
  });

  revalidatePath("/admin/users");
  return {
    ok: true,
    message: dict.actions.users.resetDone(user.name),
    tempPassword,
  };
}

/** Admin promotes/demotes an existing user. Can't change your own role (avoids accidentally locking out the only admin). */
export async function updateUserRole(
  userId: string,
  role: Role
): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());

  if (role !== "ADMIN" && role !== "MEMBER") {
    return { ok: false, message: dict.actions.users.invalidRole };
  }
  if (userId === session.user.id) {
    return { ok: false, message: dict.actions.users.cannotChangeOwnRole };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: dict.actions.users.notFound };

  // Bump tokenVersion so the change takes effect immediately (forces
  // re-login) instead of waiting for their current session to expire.
  await prisma.user.update({ where: { id: userId }, data: { role, tokenVersion: { increment: 1 } } });

  revalidatePath("/admin/users");
  return { ok: true, message: dict.actions.users.roleChanged(user.name, role) };
}

/**
 * Admin assigns (or clears) the one site this teacher is permanently
 * stationed at — the sole input to check-in/out validation (see
 * getExpectedSite in src/lib/geo.ts). Pass null to unassign (blocks that
 * teacher's check-in/out until a site is set again).
 */
export async function updateUserSite(
  userId: string,
  campusLocationId: string | null
): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const dict = getDictionary(getLocale());

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: dict.actions.users.notFound };

  if (campusLocationId) {
    const site = await prisma.campusLocation.findUnique({ where: { id: campusLocationId } });
    if (!site) return { ok: false, message: dict.actions.users.invalidSite };
    await prisma.user.update({ where: { id: userId }, data: { campusLocationId } });
    revalidatePath("/admin/users");
    revalidatePath("/teachers");
    revalidatePath("/checkin");
    return { ok: true, message: dict.actions.users.siteChanged(user.name, site.name) };
  }

  await prisma.user.update({ where: { id: userId }, data: { campusLocationId: null } });
  revalidatePath("/admin/users");
  revalidatePath("/teachers");
  revalidatePath("/checkin");
  return { ok: true, message: dict.actions.users.siteCleared(user.name) };
}

/**
 * Admin deletes a MEMBER account. Admins can never delete another admin
 * account (or their own) — only a MEMBER can be removed this way, which
 * avoids one admin locking another out or accidentally removing themselves.
 * Deleting a user also removes their schedules/attendance/leave-and-attest
 * requests (required relations that can't dangle); any requests they
 * *approved* as an admin have that reference cleared instead of being deleted.
 */
export async function deleteUser(userId: string): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());

  if (userId === session.user.id) {
    return { ok: false, message: dict.actions.users.cannotDeleteSelf };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: dict.actions.users.notFound };
  if (user.role === "ADMIN") {
    return { ok: false, message: dict.actions.users.cannotDeleteAdmin };
  }

  await prisma.$transaction([
    prisma.schedule.deleteMany({ where: { teacherId: userId } }),
    prisma.attendance.deleteMany({ where: { userId } }),
    prisma.leaveRequest.updateMany({ where: { approverId: userId }, data: { approverId: null } }),
    prisma.leaveRequest.deleteMany({ where: { requesterId: userId } }),
    prisma.timeAttestation.updateMany({ where: { approverId: userId }, data: { approverId: null } }),
    prisma.timeAttestation.deleteMany({ where: { requesterId: userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  revalidatePath("/admin/users");
  return { ok: true, message: dict.actions.users.deleted(user.name) };
}

/** Self-service: the logged-in user sets their own new password (forced after admin creates/resets an account). */
export async function changeOwnPassword(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return { ok: false, message: dict.actions.pleaseSignInAgain };

  const newPassword = (formData.get("newPassword") as string) || "";
  const confirm = (formData.get("confirm") as string) || "";

  if (newPassword.length < 8) {
    return { ok: false, message: dict.actions.users.passwordTooShort };
  }
  if (newPassword !== confirm) {
    return { ok: false, message: dict.actions.users.passwordMismatch };
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: session.user.id },
    // Bump tokenVersion too: this JWT will pick up the new value at the next
    // request since it's the token that changed password, so this session
    // keeps working, but it invalidates any OTHER device's session for the
    // same account (e.g. left logged in elsewhere).
    data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
  });

  return { ok: true, message: dict.actions.users.passwordChanged };
}
