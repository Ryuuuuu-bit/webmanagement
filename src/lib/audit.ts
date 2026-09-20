import { prisma } from "./prisma";

/**
 * Security audit trail (AuditLog table). Every sign-in attempt and every
 * account-affecting action lands here so Admin can answer "who did what,
 * when, from where" — e.g. an attendance dispute, or spotting a brute-force
 * pattern. Writes are best-effort and never block or fail the action that
 * triggered them.
 */
export type AuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGIN_LOCKED"
  | "LOGIN_SUSPENDED"
  | "LOGIN_TEMP_EXPIRED"
  | "LOGIN_PASSKEY"
  | "LOGIN_ENROLLMENT"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET_BY_ADMIN"
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_COMPLETED"
  | "PASSWORD_SETUP_EMAIL_SENT"
  | "USERNAME_CHANGED"
  | "SIGNED_OUT_EVERYWHERE"
  | "USER_CREATED"
  | "USER_SUSPENDED"
  | "USER_REACTIVATED"
  | "USER_DELETED"
  | "ROLE_CHANGED"
  | "ENROLLMENT_LINK_CREATED"
  | "ENROLLED"
  | "PASSKEY_REGISTERED"
  | "PASSKEY_REMOVED"
  | "PASSKEYS_CLEARED_BY_ADMIN"
  | "DEVICE_APPROVED"
  | "DEVICE_REJECTED"
  | "SHARED_DEVICE_DETECTED"
  | "POLICY_CHANGED"
  | "PROFILE_EDITED"
  | "RECORD_DELETED";

export async function logAudit(entry: {
  action: AuditAction;
  actorId?: string | null;
  targetUserId?: string | null;
  ip?: string | null;
  detail?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        targetUserId: entry.targetUserId ?? null,
        ip: entry.ip ?? null,
        detail: entry.detail ?? null,
      },
    });
  } catch {
    // Auditing must never take the real action down with it.
  }
}
