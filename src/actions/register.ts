"use server";

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sendVerificationEmail } from "@/lib/mailer";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function baseUrl() {
  return process.env.NEXTAUTH_URL || "http://localhost:3000";
}

async function issueVerificationToken(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: { userId, token, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });
  return token;
}

/** Self-registration (FR-signup): create the account, then email a Gmail verification link. */
export async function registerUser(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const name = (formData.get("name") as string || "").trim();
  const email = (formData.get("email") as string || "").trim().toLowerCase();
  const password = (formData.get("password") as string) || "";
  const confirm = (formData.get("confirm") as string) || "";

  if (!name || !email || !password) {
    return { ok: false, message: "กรอกข้อมูลให้ครบทุกช่อง" };
  }
  if (password.length < 8) {
    return { ok: false, message: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" };
  }
  if (password !== confirm) {
    return { ok: false, message: "รหัสผ่านทั้งสองช่องไม่ตรงกัน" };
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, message: "รูปแบบอีเมลไม่ถูกต้อง" };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, message: "อีเมลนี้มีบัญชีอยู่แล้ว ลองเข้าสู่ระบบ หรือขอส่งอีเมลยืนยันใหม่" };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: "MEMBER" },
  });

  const token = await issueVerificationToken(user.id);
  const verifyUrl = `${baseUrl()}/verify-email?token=${token}`;

  try {
    await sendVerificationEmail(email, name, verifyUrl);
  } catch (err) {
    console.error("sendVerificationEmail failed:", err);
    return {
      ok: false,
      message: "สมัครสำเร็จ แต่ส่งอีเมลยืนยันไม่สำเร็จ กรุณาลองขอส่งอีเมลยืนยันใหม่ภายหลัง",
    };
  }

  return { ok: true, message: `ส่งอีเมลยืนยันไปที่ ${email} แล้ว กรุณาเช็คกล่องจดหมาย (รวมถึง Spam) เพื่อเปิดใช้งานบัญชี` };
}

/** Resend a verification email — used from the login page when a user's account isn't verified yet. */
export async function resendVerification(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData
): Promise<{ ok: boolean; message: string }> {
  const email = (formData.get("email") as string || "").trim().toLowerCase();
  if (!email) return { ok: false, message: "กรอกอีเมล" };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { ok: false, message: "ไม่พบบัญชีอีเมลนี้" };
  if (user.emailVerified) return { ok: true, message: "อีเมลนี้ยืนยันแล้ว เข้าสู่ระบบได้เลย" };

  const token = await issueVerificationToken(user.id);
  const verifyUrl = `${baseUrl()}/verify-email?token=${token}`;

  try {
    await sendVerificationEmail(email, user.name, verifyUrl);
  } catch (err) {
    console.error("sendVerificationEmail failed:", err);
    return { ok: false, message: "ส่งอีเมลยืนยันไม่สำเร็จ ลองใหม่อีกครั้งภายหลัง" };
  }

  return { ok: true, message: `ส่งอีเมลยืนยันไปที่ ${email} อีกครั้งแล้ว` };
}
