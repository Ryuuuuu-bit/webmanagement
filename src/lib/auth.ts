import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Basic brute-force protection: lock an email out after too many failed
// attempts in a short window. In-memory only (resets on redeploy/restart,
// and only works because this app runs as a single long-lived container,
// not multiple instances) — good enough for this app's scale without
// bringing in Redis or another store.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; firstFailAt: number; lockedUntil?: number }>();

function isLocked(email: string) {
  const entry = loginAttempts.get(email);
  return !!(entry?.lockedUntil && entry.lockedUntil > Date.now());
}

function recordFailure(email: string) {
  const now = Date.now();
  const entry = loginAttempts.get(email);
  if (!entry || now - entry.firstFailAt > WINDOW_MS) {
    loginAttempts.set(email, { count: 1, firstFailAt: now });
    return;
  }
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) entry.lockedUntil = now + LOCK_MS;
}

function recordSuccess(email: string) {
  loginAttempts.delete(email);
}

// 90 days — long enough that someone who installs this as a home-screen app
// (see manifest.ts) essentially never has to log in again on that device.
// The lockout/tokenVersion checks above and in the jwt callback still apply
// on every request, so a longer-lived session doesn't weaken password or
// role-change enforcement, it only avoids re-prompting for credentials.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

export const authOptions: AuthOptions = {
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email.trim().toLowerCase();

        if (isLocked(email)) {
          throw new Error("TOO_MANY_ATTEMPTS");
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          recordFailure(email);
          return null;
        }
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) {
          recordFailure(email);
          return null;
        }
        recordSuccess(email);
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
        // (password reset/changed or role changed elsewhere), this JWT was
        // issued before that change — reject it instead of trusting stale
        // claims baked into the token.
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { tokenVersion: true },
        });
        token.invalid = !fresh || fresh.tokenVersion !== token.tokenVersion;
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
