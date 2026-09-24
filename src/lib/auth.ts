import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { describeDevice } from "@/lib/device";
import {
  getClientIp,
  getLockRemainingMinutes,
  recordLoginFailure,
  recordLoginSuccess,
  redeemLoginTicket,
} from "@/lib/security";

// 90 days — long enough that someone who installs this as a home-screen app
// (see manifest.ts) essentially never has to log in again on that device.
// The isActive/tokenVersion checks in the jwt callback still apply on every
// request, so a longer-lived session doesn't weaken password, suspension or
// role-change enforcement, it only avoids re-prompting for credentials.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

// Error codes surfaced to the login page via signIn()'s `error` field.
// Anything else the page treats as "wrong email or password".
export const AUTH_ERRORS = {
  tooManyAttempts: "TOO_MANY_ATTEMPTS", // suffixed ":<minutes remaining>"
  suspended: "ACCOUNT_SUSPENDED",
  tempExpired: "TEMP_PASSWORD_EXPIRED",
} as const;

type SessionUser = { id: string; name: string; email: string; role: "ADMIN" | "MEMBER"; tokenVersion: number };

async function markLoggedIn(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

export const authOptions: AuthOptions = {
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  providers: [
    // ---- Email + password -------------------------------------------
    CredentialsProvider({
      id: "credentials",
      name: "credentials",
      credentials: {
        // Username (client request) — an email is accepted too, so nobody
        // who learned the old way is locked out.
        identifier: { label: "Username or email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req): Promise<SessionUser | null> {
        if (!credentials?.identifier || !credentials?.password) return null;
        const identifier = credentials.identifier.trim().toLowerCase();
        const ip = getClientIp(req?.headers as Record<string, string | undefined> | undefined);
        const device = describeDevice(req?.headers as Record<string, string | undefined> | undefined);

        const user = await prisma.user.findFirst({
          where: identifier.includes("@") ? { email: identifier } : { username: identifier },
        });
        // Lock by the account's own id once we know which account this
        // identifier maps to, so typing the username vs. the email for the
        // same account shares one attempt budget instead of getting two
        // independent ones. An identifier matching no account just locks by
        // the literal string typed — there's no real account to protect
        // beyond the coarser per-IP cap in that case anyway.
        const lockId = user ? `u:${user.id}` : identifier;

        const lockedMinutes = await getLockRemainingMinutes(lockId, ip);
        if (lockedMinutes > 0) {
          await logAudit({ action: "LOGIN_LOCKED", ip, device, detail: identifier });
          throw new Error(`${AUTH_ERRORS.tooManyAttempts}:${lockedMinutes}`);
        }

        if (!user) {
          await recordLoginFailure(lockId, ip);
          await logAudit({ action: "LOGIN_FAILED", ip, device, detail: `${identifier} (no such account)` });
          return null;
        }
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) {
          await recordLoginFailure(lockId, ip);
          await logAudit({ action: "LOGIN_FAILED", targetUserId: user.id, ip, device, detail: identifier });
          return null;
        }
        // Password is right — now the account-state checks. These are
        // reported distinctly (not as "wrong password") because the person
        // genuinely knows their password and needs to be told what to do.
        if (!user.isActive) {
          await logAudit({ action: "LOGIN_SUSPENDED", targetUserId: user.id, ip, device });
          throw new Error(AUTH_ERRORS.suspended);
        }
        if (!user.passwordSetAt && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt < new Date()) {
          await logAudit({ action: "LOGIN_TEMP_EXPIRED", targetUserId: user.id, ip, device });
          throw new Error(AUTH_ERRORS.tempExpired);
        }

        await Promise.all([
          recordLoginSuccess(lockId, ip),
          markLoggedIn(user.id),
          logAudit({ action: "LOGIN_SUCCESS", actorId: user.id, targetUserId: user.id, ip, device }),
        ]);
        return { id: user.id, name: user.name, email: user.email, role: user.role, tokenVersion: user.tokenVersion };
      },
    }),

    // ---- One-time ticket (passkey login / enrollment link) -----------
    // The server has already verified the person by the time a ticket
    // exists (see src/actions/passkeyLogin.ts and src/actions/enrollment.ts);
    // this provider just turns that proof into a session. Tickets are
    // single-use and expire in 60s, so there's nothing to brute-force.
    CredentialsProvider({
      id: "ticket",
      name: "ticket",
      credentials: { ticket: { label: "Ticket", type: "text" } },
      async authorize(credentials, req): Promise<SessionUser | null> {
        if (!credentials?.ticket) return null;
        const ip = getClientIp(req?.headers as Record<string, string | undefined> | undefined);
        const device = describeDevice(req?.headers as Record<string, string | undefined> | undefined);
        const redeemed = await redeemLoginTicket(credentials.ticket);
        if (!redeemed) return null;
        const user = await prisma.user.findUnique({ where: { id: redeemed.userId } });
        if (!user) return null;
        if (!user.isActive) {
          await logAudit({ action: "LOGIN_SUSPENDED", targetUserId: user.id, ip, device });
          throw new Error(AUTH_ERRORS.suspended);
        }
        // "password" tickets just re-establish this browser's session after a
        // self-service password change (tokenVersion moved on) — that event is
        // already in the log as PASSWORD_CHANGED, so don't count it as a login.
        await Promise.all([
          redeemed.purpose === "password" ? Promise.resolve() : markLoggedIn(user.id),
          redeemed.purpose === "password"
            ? Promise.resolve()
            : logAudit({
                action: redeemed.purpose === "enrollment" ? "LOGIN_ENROLLMENT" : "LOGIN_PASSKEY",
                actorId: user.id,
                targetUserId: user.id,
                ip, device,
              }),
        ]);
        return { id: user.id, name: user.name, email: user.email, role: user.role, tokenVersion: user.tokenVersion };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Fresh sign-in: stamp the token with the tokenVersion in effect right now.
        token.id = (user as any).id;
        token.role = (user as any).role;
        token.tokenVersion = (user as any).tokenVersion;
        token.invalid = false;
      } else if (token.id) {
        // Every other request: if the account's tokenVersion has moved on
        // (password reset/changed, role changed, "sign out everywhere") or
        // the account was suspended, this JWT is stale — reject it instead
        // of trusting claims baked into the token. Also re-check the temp
        // password's 7-day expiry here, not just at the original sign-in:
        // sessions last up to SESSION_MAX_AGE_SECONDS, far longer than 7
        // days, so without this an account could keep working on an expired
        // temp password for the rest of the session's lifetime.
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { tokenVersion: true, isActive: true, passwordSetAt: true, tempPasswordExpiresAt: true },
        });
        const tempExpired = !!fresh && !fresh.passwordSetAt && !!fresh.tempPasswordExpiresAt && fresh.tempPasswordExpiresAt < new Date();
        token.invalid = !fresh || !fresh.isActive || fresh.tokenVersion !== token.tokenVersion || tempExpired;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.invalid) {
        // Signal "no session" to callers without breaking the session shape.
        return { ...session, user: undefined } as any;
      }
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
};
