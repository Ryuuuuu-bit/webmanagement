import crypto from "crypto";
import { headers } from "next/headers";
import { prisma } from "./prisma";

/**
 * Shared account-security plumbing: client IP extraction, the DB-backed
 * login lockout, one-time sign-in tickets, and the password policy. Plain
 * server code (not "use server") so it can be used from src/lib/auth.ts's
 * NextAuth callbacks as well as from Server Actions.
 */

// ---------------------------------------------------------------- IP ----

type HeaderSource = Headers | Record<string, string | string[] | undefined> | undefined;

function readHeader(src: HeaderSource, name: string): string | undefined {
  if (!src) return undefined;
  if (src instanceof Headers) return src.get(name) ?? undefined;
  const v = src[name] ?? src[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** Client IP as seen through Railway's proxy (first hop of x-forwarded-for), or "unknown". */
export function getClientIp(src?: HeaderSource): string {
  const source = src ?? headers();
  const xff = readHeader(source, "x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return readHeader(source, "x-real-ip")?.trim() || "unknown";
}

// ----------------------------------------------------------- lockout ----

// 5 wrong passwords for one email from one IP → that pair is locked 15 min.
// 30 failures from one IP across any emails in 15 min → that IP is locked
// 15 min (stops someone cycling through the staff list). Keyed by email+IP
// rather than email alone so a stranger can't lock a teacher out of their
// own phone by guessing at their address from elsewhere.
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL_IP = 5;
const MAX_PER_IP = 30;

function lockKeys(email: string, ip: string) {
  return { pair: `e:${email}|${ip}`, ip: `ip:${ip}` };
}

/** Minutes remaining on a lock, or 0 if not locked. */
export async function getLockRemainingMinutes(email: string, ip: string): Promise<number> {
  const keys = lockKeys(email, ip);
  const rows = await prisma.loginLock.findMany({ where: { key: { in: [keys.pair, keys.ip] } } });
  const now = Date.now();
  let until = 0;
  for (const r of rows) {
    if (r.lockedUntil && r.lockedUntil.getTime() > now) until = Math.max(until, r.lockedUntil.getTime());
  }
  return until ? Math.max(1, Math.ceil((until - now) / 60000)) : 0;
}

async function bump(key: string, max: number) {
  const now = new Date();
  const row = await prisma.loginLock.findUnique({ where: { key } });
  if (!row || now.getTime() - row.firstFailAt.getTime() > WINDOW_MS) {
    await prisma.loginLock.upsert({
      where: { key },
      create: { key, count: 1, firstFailAt: now, lockedUntil: null },
      update: { count: 1, firstFailAt: now, lockedUntil: null },
    });
    return;
  }
  const count = row.count + 1;
  await prisma.loginLock.update({
    where: { key },
    data: { count, lockedUntil: count >= max ? new Date(now.getTime() + LOCK_MS) : row.lockedUntil },
  });
}

export async function recordLoginFailure(email: string, ip: string) {
  const keys = lockKeys(email, ip);
  await Promise.all([bump(keys.pair, MAX_PER_EMAIL_IP), bump(keys.ip, MAX_PER_IP)]);
}

export async function recordLoginSuccess(email: string, ip: string) {
  const keys = lockKeys(email, ip);
  await prisma.loginLock.deleteMany({ where: { key: keys.pair } });
}

// ----------------------------------------------------------- tickets ----

const TICKET_TTL_MS = 60 * 1000;

export function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * Mint a one-time sign-in ticket for `userId` after the server has already
 * verified who they are (passkey assertion / enrollment link). The client
 * immediately trades it for a session via the "ticket" provider in
 * src/lib/auth.ts, which consumes it. 60-second lifetime, hash-only storage.
 */
export async function issueLoginTicket(userId: string, purpose: "passkey" | "enrollment"): Promise<string> {
  const token = randomToken();
  await prisma.loginTicket.create({
    data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TICKET_TTL_MS) },
  });
  return token;
}

/** Consumes a ticket (deletes it whether or not it's valid) and returns the userId + purpose it was for, or null. */
export async function redeemLoginTicket(token: string): Promise<{ userId: string; purpose: string } | null> {
  const tokenHash = sha256(token);
  const row = await prisma.loginTicket.findUnique({ where: { tokenHash } });
  if (!row) return null;
  await prisma.loginTicket.delete({ where: { id: row.id } });
  if (row.expiresAt < new Date()) return null;
  return { userId: row.userId, purpose: row.purpose };
}

// --------------------------------------------------- password policy ----

// NIST-style: length is what matters, no forced symbol/uppercase rules, but
// reject the obvious junk people reach for. Deliberately small — this is a
// closed staff system, not a public sign-up form.
const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000", "12341234", "12345678a",
  "password", "password1", "password123", "passw0rd", "p@ssw0rd", "qwerty123", "qwertyui", "qwerty12",
  "abcd1234", "abc12345", "a1234567", "iloveyou", "sunshine", "football", "baseball", "princess",
  "letmein1", "welcome1", "admin123", "admin1234", "administrator", "teacher1", "teacher123",
  "aaaaaaaa", "asdfghjk", "zxcvbnm1", "1q2w3e4r", "1qaz2wsx", "qazwsx123", "123qweasd",
  "thailand", "bangkok1", "changeme", "temp1234", "test1234", "user1234", "guest123",
]);

export type PasswordProblem = "too_short" | "too_long" | "too_common" | "contains_email";

/** Returns the first policy problem, or null if the password is acceptable. */
export function checkPasswordPolicy(password: string, email?: string | null, username?: string | null): PasswordProblem | null {
  if (password.length < 8) return "too_short";
  // bcrypt only looks at the first 72 bytes — refuse anything longer so a
  // user isn't fooled into thinking the tail of a long passphrase counts.
  if (Buffer.byteLength(password, "utf8") > 72) return "too_long";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "too_common";
  if (/^(.)\1+$/.test(password)) return "too_common"; // aaaaaaaa
  if (/^(?:0123456789|1234567890|abcdefghijklmnopqrstuvwxyz)/.test(lower) && lower.length <= 10) return "too_common";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "contains_email";
  const uname = username?.toLowerCase();
  if (uname && uname.length >= 4 && lower.includes(uname)) return "contains_email";
  return null;
}

// Sign-in names: 3–32 chars of a-z 0-9 . _ - (lowercased before storing).
// Anything with "@" is treated as an email by the login page, so usernames
// can never contain one.
export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase();
}
