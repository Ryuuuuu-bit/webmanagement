"use server";

import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { buildLoginOptions, verifyLoginAssertion } from "@/lib/webauthn";
import { getClientIp, issueLoginTicket } from "@/lib/security";
import { logAudit } from "@/lib/audit";

/**
 * Passwordless sign-in with a registered device's Face ID / fingerprint
 * (the same passkeys teachers register on the check-in page). Two steps
 * from the login page: get a challenge, then trade the browser's assertion
 * for a one-time ticket that the "ticket" NextAuth provider turns into a
 * session. Anonymous by design — there's no session yet.
 */
export async function startPasskeyLogin() {
  return buildLoginOptions();
}

export async function finishPasskeyLogin(
  challengeKey: string,
  response: AuthenticationResponseJSON
): Promise<{ ok: true; ticket: string } | { ok: false; reason: "verify_failed" | "suspended" }> {
  const ip = getClientIp();
  const result = await verifyLoginAssertion(challengeKey, response);
  if (!result) {
    await logAudit({ action: "LOGIN_FAILED", ip, detail: "passkey assertion rejected" });
    return { ok: false, reason: "verify_failed" };
  }
  const user = await prisma.user.findUnique({ where: { id: result.userId }, select: { isActive: true } });
  if (!user?.isActive) {
    await logAudit({ action: "LOGIN_SUSPENDED", targetUserId: result.userId, ip, detail: "passkey" });
    return { ok: false, reason: "suspended" };
  }
  const ticket = await issueLoginTicket(result.userId, "passkey");
  return { ok: true, ticket };
}
