"use server";

import QRCode from "qrcode";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { getClientIp, issueLoginTicket, randomToken, sha256 } from "@/lib/security";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * "Link this phone" enrollment: Admin generates a one-time QR/link for a
 * teacher; the teacher scans it on their own phone, is signed in without
 * ever typing a password, and is walked through registering that phone's
 * Face ID/fingerprint as a passkey (see src/app/enroll/[token]). From then
 * on the login page leads with the passkey prompt on that phone. The
 * password stays as a fallback for a new device — Admin can reset it.
 */

const ENROLLMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function appOrigin() {
  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export type EnrollmentLink = { url: string; qrSvg: string; expiresAt: string };

/** Admin: mint a fresh enrollment link for one user (any earlier unused links for them are voided). */
export async function createEnrollmentLink(
  userId: string
): Promise<{ ok: true; link: EnrollmentLink; message: string } | { ok: false; message: string }> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user || session.user.role !== "ADMIN") return { ok: false, message: dict.actions.unauthorized };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, isActive: true } });
  if (!user) return { ok: false, message: dict.actions.users.notFound };
  if (!user.isActive) return { ok: false, message: dict.actions.enrollment.userSuspended };

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS);
  await prisma.$transaction([
    prisma.enrollmentToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.enrollmentToken.create({ data: { userId, tokenHash: sha256(token), createdById: session.user.id, expiresAt } }),
  ]);

  const url = `${appOrigin()}/enroll/${token}`;
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, width: 220, errorCorrectionLevel: "M" });
  await logAudit({ action: "ENROLLMENT_LINK_CREATED", actorId: session.user.id, targetUserId: userId, ip: getClientIp() });

  return { ok: true, link: { url, qrSvg, expiresAt: expiresAt.toISOString() }, message: dict.actions.enrollment.linkCreated(user.name) };
}

export type EnrollmentPreview =
  | { status: "ok"; userName: string; userEmail: string }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "used" };

/** Public: what the enrollment page shows before the teacher taps "link this device". Never reveals anything for a bad token. */
export async function previewEnrollment(token: string): Promise<EnrollmentPreview> {
  if (!token || token.length < 20) return { status: "invalid" };
  const row = await prisma.enrollmentToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { name: true, email: true, isActive: true } } },
  });
  if (!row || !row.user.isActive) return { status: "invalid" };
  if (row.usedAt) return { status: "used" };
  if (row.expiresAt < new Date()) return { status: "expired" };
  return { status: "ok", userName: row.user.name, userEmail: row.user.email };
}

/**
 * Public: consume the link and hand back a one-time sign-in ticket. Also
 * clears the "must change temporary password" gate — the person proved
 * possession of an Admin-issued link, which is the same trust level as the
 * temporary password, and they'll typically never use a password on this
 * phone at all.
 */
export async function redeemEnrollment(
  token: string
): Promise<{ ok: true; ticket: string } | { ok: false; status: "invalid" | "expired" | "used" }> {
  const ip = getClientIp();
  const preview = await previewEnrollment(token);
  if (preview.status !== "ok") return { ok: false, status: preview.status };

  const row = await prisma.enrollmentToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row) return { ok: false, status: "invalid" };

  // Atomic claim: only the first redeem wins if the same QR is scanned twice.
  const claimed = await prisma.enrollmentToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, status: "used" };

  await prisma.user.update({
    where: { id: row.userId },
    data: { mustChangePassword: false, tempPasswordExpiresAt: null },
  });
  await logAudit({ action: "ENROLLED", actorId: row.userId, targetUserId: row.userId, ip });
  const ticket = await issueLoginTicket(row.userId, "enrollment");
  return { ok: true, ticket };
}
