"use server";

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Unauthorized");
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

  const name = (formData.get("name") as string || "").trim();
  const email = (formData.get("email") as string || "").trim().toLowerCase();
  const role = (formData.get("role") as string || "MEMBER") as Role;
  const departmentId = (formData.get("departmentId") as string) || null;

  if (!name || !email) {
    return { ok: false, message: "กรอกชื่อและอีเมลให้ครบ" };
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, message: "รูปแบบอีเมลไม่ถูกต้อง" };
  }
  if (role !== "ADMIN" && role !== "MEMBER") {
    return { ok: false, message: "บทบาทไม่ถูกต้อง" };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, message: "อีเมลนี้มีบัญชีอยู่แล้ว" };
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
      mustChangePassword: true,
    },
  });

  revalidatePath("/admin/users");
  return {
    ok: true,
    message: `สร้างบัญชีให้ ${name} แล้ว — แจ้งรหัสผ่านชั่วคราวด้านล่างนี้ให้เจ้าตัวทันที (จะไม่แสดงซ้ำอีก)`,
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

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: "ไม่พบผู้ใช้นี้" };

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: true },
  });

  revalidatePath("/admin/users");
  return {
    ok: true,
    message: `รีเซ็ตรหัสผ่านของ ${user.name} แล้ว — แจ้งรหัสผ่านชั่วคราวด้านล่างนี้ให้เจ้าตัวทันที (จะไม่แสดงซ้ำอีก)`,
    tempPassword,
  };
}

/** Admin promotes/demotes an existing user. Can't change your own role (avoids accidentally locking out the only admin). */
export async function updateUserRole(
  userId: string,
  role: Role
): Promise<{ ok: boolean; message: string }> {
  const session = await requireAdmin();

  if (role !== "ADMIN" && role !== "MEMBER") {
    return { ok: false, message: "บทบาทไม่ถูกต้อง" };
  }
  if (userId === session.user.id) {
    return { ok: false, message: "ไม่สามารถเปลี่ยนบทบาทของตัวเองได้ ให้ผู้ดูแลระบบคนอื่นเปลี่ยนให้" };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, message: "ไม่พบผู้ใช้นี้" };

  await prisma.user.update({ where: { id: userId }, data: { role } });

  revalidatePath("/admin/users");
  return { ok: true, message: `เปลี่ยนบทบาทของ ${user.name} เป็น ${role} แล้ว` };
}

/** Self-service: the logged-in user sets their own new password (forced after admin creates/resets an account). */
export async function changeOwnPassword(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false, message: "กรุณาเข้าสู่ระบบใหม่" };

  const newPassword = (formData.get("newPassword") as string) || "";
  const confirm = (formData.get("confirm") as string) || "";

  if (newPassword.length < 8) {
    return { ok: false, message: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" };
  }
  if (newPassword !== confirm) {
    return { ok: false, message: "รหัสผ่านทั้งสองช่องไม่ตรงกัน" };
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  return { ok: true, message: "เปลี่ยนรหัสผ่านสำเร็จ" };
}
