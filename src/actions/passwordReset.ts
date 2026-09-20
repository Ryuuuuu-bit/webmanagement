"use server";

import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { checkPasswordPolicy, getClientIp, randomToken, sha256 } from "@/lib/security";
import { isEmailConfigured, renderEmail, sendEmail } from "@/lib/email";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * Email-based password setup, Admin-initiated only (client decision: no
 * self-service "forgot password" — a teacher who forgets asks Admin, who
 * resets or sends this link). Admin sends a new/reset account its "set your
 * password" link (7-day, single-use, stored hashed) instead of reading a
 * temporary password out loud; it lands on /reset-password/<token>.
 */

const RESET_TTL_MS = 30 * 60 * 1000;
const SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function appOrigin() {
  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function mintAndSend(userId: string, purpose: "reset" | "setup", actorId: string | null, ip: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, username: true } });
  if (!user) return false;
  const dict = getDictionary(getLocale());
  const token = randomToken(32);
  const ttl = purpose === "setup" ? SETUP_TTL_MS : RESET_TTL_MS;
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.passwordResetToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttl) } }),
  ]);
  const url = `${appOrigin()}/reset-password/${token}`;
  const t = purpose === "setup" ? dict.email.setup : dict.email.reset;
  const { html, text } = renderEmail({
    title: t.title,
    greeting: t.greeting(user.name),
    body: t.body(user.username ?? user.email),
    buttonLabel: t.button,
    url,
    footer: t.footer,
  });
  const sent = await sendEmail({ to: user.email, subject: t.subject, html, text });
  await logAudit({
    action: purpose === "setup" ? "PASSWORD_SETUP_EMAIL_SENT" : "PASSWORD_RESET_REQUESTED",
    actorId,
    targetUserId: userId,
    ip,
    detail: sent.ok ? user.email : `email failed: ${sent.reason}`,
  });
  return sent.ok;
}

/** Admin: email a new/reset account its "set your password" link (7 days) instead of relaying a temporary password. */
export async function sendPasswordSetupEmail(userId: string): Promise<{ ok: boolean; message: string }> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user || session.user.role !== "ADMIN") return { ok: false, message: dict.actions.unauthorized };
  if (!isEmailConfigured()) return { ok: false, message: dict.actions.passwordReset.notConfigured };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, isActive: true } });
  if (!user) return { ok: false, message: dict.actions.users.notFound };
  if (!user.isActive) return { ok: false, message: dict.actions.enrollment.userSuspended };
  const sent = await mintAndSend(userId, "setup", session.user.id, getClientIp());
  return sent
    ? { ok: true, message: dict.actions.passwordReset.setupSent(user.name, user.email) }
    : { ok: false, message: dict.actions.passwordReset.sendFailed };
}

export type ResetPreview = { status: "ok"; name: string; purpose: string } | { status: "invalid" } | { status: "expired" } | { status: "used" };

export async function previewPasswordReset(token: string): Promise<ResetPreview> {
  if (!token || token.length < 20) return { status: "invalid" };
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { name: true, isActive: true } } },
  });
  if (!row || !row.user.isActive) return { status: "invalid" };
  if (row.usedAt) return { status: "used" };
  if (row.expiresAt < new Date()) return { status: "expired" };
  return { status: "ok", name: row.user.name, purpose: row.purpose };
}

/** Public: set a new password with a valid link. Kicks every existing session for the account. */
export async function completePasswordReset(
  token: string,
  newPassword: string,
  confirm: string
): Promise<{ ok: boolean; message: string }> {
  const dict = getDictionary(getLocale());
  const ip = getClientIp();
  const preview = await previewPasswordReset(token);
  if (preview.status !== "ok") {
    return { ok: false, message: preview.status === "used" ? dict.reset.used : preview.status === "expired" ? dict.reset.expired : dict.reset.invalid };
  }
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row) return { ok: false, message: dict.reset.invalid };

  const problem = checkPasswordPolicy(newPassword, row.user.email, row.user.username);
  if (problem === "too_short") return { ok: false, message: dict.actions.users.passwordTooShort };
  if (problem === "too_long") return { ok: false, message: dict.actions.users.passwordTooLong };
  if (problem === "too_common") return { ok: false, message: dict.actions.users.passwordTooCommon };
  if (problem === "contains_email") return { ok: false, message: dict.actions.users.passwordContainsEmail };
  if (newPassword !== confirm) return { ok: false, message: dict.actions.users.passwordMismatch };

  const claimed = await prisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count === 0) return { ok: false, message: dict.reset.used };

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: row.userId },
    data: { passwordHash, mustChangePassword: false, tempPasswordExpiresAt: null, tokenVersion: { increment: 1 } },
  });
  await logAudit({ action: "PASSWORD_RESET_COMPLETED", actorId: row.userId, targetUserId: row.userId, ip, detail: row.purpose });
  return { ok: true, message: dict.reset.done };
}
