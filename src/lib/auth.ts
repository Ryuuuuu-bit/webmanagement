import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
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

        const lockedMinutes = await getLockRemainingMinutes(identifier, ip);
        if (lockedMinutes > 0) {
          await logAudit({ action: "LOGIN_LOCKED", ip, detail: identifier });
          throw new Error(`${AUTH_ERRORS.tooManyAttempts}:${lockedMinutes}`);
        }

        const user = await prisma.user.findFirst({
          where: identifier.includes("@") ? { email: identifier } : { username: identifier },
        });
        if (!user) {
          await recordLoginFailure(identifier, ip);
          await logAudit({ action: "LOGIN_FAILED", ip, detail: `${identifier} (no such account)` });
          return null;
        }
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) {
          await recordLoginFailure(identifier, ip);
          await logAudit({ action: "LOGIN_FAILED", targetUserId: user.id, ip, detail: identifier });
          return null;
        }
        // Password is right — now the account-state checks. These are
        // reported distinctly (not as "wrong password") because the person
        // genuinely knows their password and needs to be told what to do.
        if (!user.isActive) {
          await logAudit({ action: "LOGIN_SUSPENDED", targetUserId: user.id, ip });
          throw new Error(AUTH_ERRORS.suspended);
        }
        if (user.mustChangePassword && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt < new Date()) {
          await logAudit({ action: "LOGIN_TEMP_EXPIRED", targetUserId: user.id, ip });
          throw new Error(AUTH_ERRORS.tempExpired);
        }

        await Promise.all([
          recordLoginSuccess(identifier, ip),
          markLoggedIn(user.id),
          logAudit({ action: "LOGIN_SUCCESS", actorId: user.id, targetUserId: user.id, ip }),
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
        const redeemed = await redeemLoginTicket(credentials.ticket);
        if (!redeemed) return null;
        const user = await prisma.user.findUnique({ where: { id: redeemed.userId } });
        if (!user) return null;
        if (!user.isActive) {
          await logAudit({ action: "LOGIN_SUSPENDED", targetUserId: user.id, ip });
          throw new Error(AUTH_ERRORS.suspended);
        }
        await Promise.all([
          markLoggedIn(user.id),
          logAudit({
            action: redeemed.purpose === "enrollment" ? "LOGIN_ENROLLMENT" : "LOGIN_PASSKEY",
            actorId: user.id,
            targetUserId: user.id,
            ip,
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
        // of trusting claims baked into the token.
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { tokenVersion: true, isActive: true },
        });
        token.invalid = !fresh || !fresh.isActive || fresh.tokenVersion !== token.tokenVersion;
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
