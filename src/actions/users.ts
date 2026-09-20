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
import { logAudit } from "@/lib/audit";
import { notifyUser } from "@/lib/notify";
import { checkPasswordPolicy, getClientIp, issueLoginTicket, normalizeUsername, USERNAME_RE } from "@/lib/security";

// A temporary password (account created / reset by Admin) is only good for
// this long; after that the login page tells the person to ask Admin for a
// fresh one (or an enrollment QR) instead of silently keeping a stale
// secret alive forever.
const TEMP_PASSWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function tempPasswordExpiry() {
  return new Date(Date.now() + TEMP_PASSWORD_TTL_MS);
}

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
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());

  const name = (formData.get("name") as string || "").trim();
  const username = normalizeUsername((formData.get("username") as string) || "");
  const email = (formData.get("email") as string || "").trim().toLowerCase();
  const role = (formData.get("role") as string || "MEMBER") as Role;
  const departmentId = (formData.get("departmentId") as string) || null;
  const campusLocationId = (formData.get("campusLocationId") as string) || null;

  if (!name || !email || !username) {
    return { ok: false, message: dict.actions.users.fillRequired };
  }
  if (!USERNAME_RE.test(username)) {
    return { ok: false, message: dict.actions.users.invalidUsername };
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
  const usernameTaken = await prisma.user.findUnique({ where: { username } });
  if (usernameTaken) {
    return { ok: false, message: dict.actions.users.usernameExists };
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const created = await prisma.user.create({
    data: {
      name,
      username,
      email,
      passwordHash,
      role,
      departmentId: departmentId || undefined,
      campusLocationId: campusLocationId || undefined,
      mustChangePassword: true,
      tempPasswordExpiresAt: tempPasswordExpiry(),
    },
  });
  await logAudit({ action: "USER_CREATED", actorId: session.user.id, targetUserId: created.id, ip: getClientIp(), detail: email });
  await notifyUser(created.id, "PASSWORD_TEMP", { expiresAt: created.tempPasswordExpiresAt?.toISOString() ?? null }, "/change-password");

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
  const session = await requireAdmin();
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
    data: { passwordHash, mustChangePassword: true, tempPasswordExpiresAt: tempPasswordExpiry(), tokenVersion: { increment: 1 } },
  });
  await logAudit({ action: "PASSWORD_RESET_BY_ADMIN", actorId: session.user.id, targetUserId: userId, ip: getClientIp() });
  await notifyUser(userId, "PASSWORD_TEMP", { expiresAt: tempPasswordExpiry().toISOString() }, "/change-password");

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
  await logAudit({ action: "ROLE_CHANGED", actorId: session.user.id, targetUserId: userId, ip: getClientIp(), detail: `${user.role} → ${role}` });
  await notifyUser(userId, "ROLE_CHANGED", { role }, "/dashboard");

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
    if (user.campusLocationId !== campusLocationId) await notifyUser(userId, "SITE_ASSIGNED", { siteName: site.name }, "/checkin");
    revalidatePath("/admin/users");
    revalidatePath("/teachers");
    revalidatePath("/checkin");
    return { ok: true, message: dict.actions.users.siteChanged(user.name, site.name) };
  }

  await prisma.user.update({ where: { id: userId }, data: { campusLocationId: null } });
  if (user.campusLocationId) await notifyUser(userId, "SITE_ASSIGNED", { siteName: null }, "/checkin");
  revalidatePath("/admin/users");
  revalidatePath("/teachers");
  revalidatePath("/checkin");
  return { ok: true, message: dict.actions.users.siteCleared(user.name) };
}

/**
 * Admin deletes an account (never their own). Another ADMIN can be removed
 * too — the seeded demo admins, a departed colleague — as long as the person
 * doing it stays, so the system always keeps at least one admin.
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
  // Another ADMIN may be removed: the admin doing it can't delete themselves
  // (checked above), so at least one admin always remains.

  await prisma.$transaction([
    prisma.schedule.deleteMany({ where: { teacherId: userId } }),
    prisma.attendance.deleteMany({ where: { userId } }),
    prisma.leaveRequest.updateMany({ where: { approverId: userId }, data: { approverId: null } }),
    prisma.leaveRequest.deleteMany({ where: { requesterId: userId } }),
    prisma.timeAttestation.updateMany({ where: { approverId: userId }, data: { approverId: null } }),
    prisma.timeAttestation.deleteMany({ where: { requesterId: userId } }),
    prisma.lessonPlan.updateMany({ where: { reviewerId: userId }, data: { reviewerId: null } }),
    prisma.lessonPlan.deleteMany({ where: { teacherId: userId } }),
    prisma.selfie.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
  await logAudit({ action: "USER_DELETED", actorId: session.user.id, targetUserId: userId, ip: getClientIp(), detail: `${user.name} <${user.email}>` });

  revalidatePath("/admin/users");
  return { ok: true, message: dict.actions.users.deleted(user.name) };
}

/**
 * Self-service password change. Requires the CURRENT password unless the
 * account is on an Admin-issued temporary password (mustChangePassword) —
 * so someone who merely finds a phone left signed in can't take the
 * account over by setting a new password. Also refuses trivially weak
 * passwords and reusing the current one (see checkPasswordPolicy).
 */
export async function changeOwnPassword(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string; ticket?: string }> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return { ok: false, message: dict.actions.pleaseSignInAgain };

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return { ok: false, message: dict.actions.pleaseSignInAgain };

  const currentPassword = (formData.get("currentPassword") as string) || "";
  const newPassword = (formData.get("newPassword") as string) || "";
  const confirm = (formData.get("confirm") as string) || "";

  if (!user.mustChangePassword) {
    if (!currentPassword) return { ok: false, message: dict.actions.users.currentPasswordRequired };
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      await logAudit({ action: "LOGIN_FAILED", actorId: user.id, targetUserId: user.id, ip: getClientIp(), detail: "wrong current password on change" });
      return { ok: false, message: dict.actions.users.currentPasswordWrong };
    }
  }

  const problem = checkPasswordPolicy(newPassword, user.email, user.username);
  if (problem === "too_short") return { ok: false, message: dict.actions.users.passwordTooShort };
  if (problem === "too_long") return { ok: false, message: dict.actions.users.passwordTooLong };
  if (problem === "too_common") return { ok: false, message: dict.actions.users.passwordTooCommon };
  if (problem === "contains_email") return { ok: false, message: dict.actions.users.passwordContainsEmail };
  if (newPassword !== confirm) return { ok: false, message: dict.actions.users.passwordMismatch };
  if (await bcrypt.compare(newPassword, user.passwordHash)) return { ok: false, message: dict.actions.users.passwordReused };

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: session.user.id },
    // Bump tokenVersion too: this JWT will pick up the new value at the next
    // request since it's the token that changed password, so this session
    // keeps working, but it invalidates any OTHER device's session for the
    // same account (e.g. left logged in elsewhere).
    data: { passwordHash, mustChangePassword: false, tempPasswordExpiresAt: null, tokenVersion: { increment: 1 } },
  });
  await logAudit({ action: "PASSWORD_CHANGED", actorId: user.id, targetUserId: user.id, ip: getClientIp() });
  // The tokenVersion bump invalidates this browser's JWT too. Hand back a
  // one-shot ticket so the form can silently re-sign-in instead of bouncing
  // the person to the login page to type the password they just set.
  const ticket = await issueLoginTicket(user.id, "password");
  return { ok: true, message: dict.actions.users.passwordChanged, ticket };
}

/** Admin changes a user's sign-in name (e.g. a typo, or a new staff-ID scheme). Sessions keep working — it's not a credential change. */
export async function updateUsername(userId: string, raw: string): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());
  const username = normalizeUsername(raw);
  if (!USERNAME_RE.test(username)) return { ok: false, message: dict.actions.users.invalidUsername };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: dict.actions.users.notFound };
  if (user.username === username) return { ok: true, message: dict.actions.users.usernameChanged(user.name, username) };

  const taken = await prisma.user.findUnique({ where: { username } });
  if (taken) return { ok: false, message: dict.actions.users.usernameExists };

  await prisma.user.update({ where: { id: userId }, data: { username } });
  await logAudit({ action: "USERNAME_CHANGED", actorId: session.user.id, targetUserId: userId, ip: getClientIp(), detail: `${user.username ?? "—"} → ${username}` });
  revalidatePath("/admin/users");
  return { ok: true, message: dict.actions.users.usernameChanged(user.name, username) };
}

/** Self-service "sign out everywhere": invalidates every session for this account, including this one. */
export async function signOutEverywhere(): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user) return { ok: false, message: dict.actions.pleaseSignInAgain };
  await prisma.user.update({ where: { id: session.user.id }, data: { tokenVersion: { increment: 1 } } });
  await logAudit({ action: "SIGNED_OUT_EVERYWHERE", actorId: session.user.id, targetUserId: session.user.id, ip: getClientIp() });
  return { ok: true, message: dict.actions.users.signedOutEverywhere };
}

/**
 * Admin suspends / reactivates an account. Suspension blocks sign-in
 * immediately (tokenVersion bump kicks any live session) but keeps every
 * record — the right call for a teacher who has left or is on long leave,
 * where deleting would also erase their attendance and leave history.
 */
export async function setUserActive(userId: string, active: boolean): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());
  if (userId === session.user.id) return { ok: false, message: dict.actions.users.cannotSuspendSelf };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: dict.actions.users.notFound };
  if (user.role === "ADMIN" && !active) return { ok: false, message: dict.actions.users.cannotSuspendAdmin };

  await prisma.user.update({
    where: { id: userId },
    data: { isActive: active, tokenVersion: { increment: 1 } },
  });
  await logAudit({ action: active ? "USER_REACTIVATED" : "USER_SUSPENDED", actorId: session.user.id, targetUserId: userId, ip: getClientIp() });

  revalidatePath("/admin/users");
  revalidatePath("/teachers");
  revalidatePath("/checkin");
  return { ok: true, message: active ? dict.actions.users.reactivated(user.name) : dict.actions.users.suspended(user.name) };
}

/**
 * Admin edits everything on a member's profile in one go (client request:
 * "admin แก้ไขข้อมูลส่วนตัวของ member ได้ทั้งหมด"): display name, sign-in
 * username, recovery email and department. Role and assigned site keep their
 * own actions (they trigger re-login / notifications). Every field is
 * validated like createUser; only fields that actually changed are written
 * and audited.
 */
export async function updateUserProfile(
  userId: string,
  input: { name: string; username: string; email: string; departmentId: string | null }
): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());

  const name = (input.name || "").trim();
  const username = normalizeUsername(input.username || "");
  const email = (input.email || "").trim().toLowerCase();
  const departmentId = input.departmentId || null;

  if (!name || !email || !username) return { ok: false, message: dict.actions.users.fillRequired };
  if (!USERNAME_RE.test(username)) return { ok: false, message: dict.actions.users.invalidUsername };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: dict.actions.users.invalidEmail };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: dict.actions.users.notFound };

  if (email !== user.email) {
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken) return { ok: false, message: dict.actions.users.emailExists };
  }
  if (username !== user.username) {
    const taken = await prisma.user.findUnique({ where: { username } });
    if (taken) return { ok: false, message: dict.actions.users.usernameExists };
  }
  if (departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!dept) return { ok: false, message: dict.actions.users.invalidDepartment };
  }

  const changes: string[] = [];
  if (name !== user.name) changes.push(`name: ${user.name} → ${name}`);
  if (username !== user.username) changes.push(`username: ${user.username ?? "—"} → ${username}`);
  if (email !== user.email) changes.push(`email: ${user.email} → ${email}`);
  if (departmentId !== user.departmentId) changes.push(`department: ${user.departmentId ?? "—"} → ${departmentId ?? "—"}`);
  if (changes.length === 0) return { ok: true, message: dict.actions.users.profileUnchanged };

  await prisma.user.update({ where: { id: userId }, data: { name, username, email, departmentId } });
  await logAudit({ action: "PROFILE_EDITED", actorId: session.user.id, targetUserId: userId, ip: getClientIp(), detail: changes.join("; ") });

  revalidatePath("/admin/users");
  revalidatePath("/teachers");
  return { ok: true, message: dict.actions.users.profileSaved(name) };
}
