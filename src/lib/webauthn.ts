import { randomBytes } from "crypto";
import { headers } from "next/headers";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  WebAuthnCredential as SimpleWebAuthnCredential,
} from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";

/**
 * Anti "buddy punching" (ฝากเช็คอิน/เช็คเอาต์แทนกัน): shared WebAuthn
 * (device fingerprint/Face ID) logic used by both the client-facing actions
 * in src/actions/webauthn.ts and the identity check that
 * src/actions/attendance.ts runs before recording a check-in/out. Kept out
 * of "use server" files so it's just plain server-side code, not itself a
 * set of Server Actions.
 */

const RP_NAME = "TeachSchedule";
// How long a registration/verification prompt has to be completed before
// its challenge expires and can no longer be used (one-time-use regardless).
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * WebAuthn ties a credential to a specific domain (rpID) and checks the
 * request actually came from that origin. Derived from the request's Host
 * header rather than hardcoded so this keeps working if the app ever moves
 * to a custom domain without a code change.
 */
export function getRpIdAndOrigin() {
  const h = headers();
  const host = h.get("host") ?? "localhost:3000";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = h.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  const rpID = host.split(":")[0];
  const origin = `${proto}://${host}`;
  return { rpID, origin };
}

/** One active challenge per user at a time — starting a new ceremony discards any unfinished one. */
async function saveChallenge(userId: string, challenge: string) {
  await prisma.webauthnChallenge.deleteMany({ where: { userId } });
  await prisma.webauthnChallenge.create({
    data: { userId, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });
}

/** Consumes (deletes) the user's pending challenge so it can never be reused, even if this call fails verification. */
async function takeChallenge(userId: string): Promise<string | null> {
  const row = await prisma.webauthnChallenge.findFirst({ where: { userId } });
  if (!row) return null;
  await prisma.webauthnChallenge.delete({ where: { id: row.id } });
  if (row.expiresAt < new Date()) return null;
  return row.challenge;
}

function toTransports(transports?: string | null): string[] | undefined {
  return transports ? transports.split(",") : undefined;
}

export async function buildRegistrationOptions(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  if (!user) throw new Error("USER_NOT_FOUND");
  const { rpID } = getRpIdAndOrigin();
  const existing = await prisma.webauthnCredential.findMany({ where: { userId } });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: existing.map((c: { credentialId: string; transports: string | null }) => ({
      id: c.credentialId,
      transports: toTransports(c.transports),
    })),
    authenticatorSelection: {
      // "platform" = the device's own biometric (Face ID / fingerprint /
      // Windows Hello), not an external security key — that's the point here.
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  await saveChallenge(userId, options.challenge);
  return options;
}

export async function finishRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  label: string | null
): Promise<{ ok: true } | { ok: false; reason: "challenge_expired" | "verify_failed" }> {
  const { rpID, origin } = getRpIdAndOrigin();
  const expectedChallenge = await takeChallenge(userId);
  if (!expectedChallenge) return { ok: false, reason: "challenge_expired" };

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch {
    return { ok: false, reason: "verify_failed" };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, reason: "verify_failed" };
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  await prisma.webauthnCredential.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports?.join(",") ?? null,
      label,
    },
  });
  return { ok: true };
}

export async function buildAuthenticationOptions(
  userId: string
): Promise<{ kind: "no_credential" } | { kind: "ok"; options: Awaited<ReturnType<typeof generateAuthenticationOptions>> }> {
  const { rpID } = getRpIdAndOrigin();
  const creds = await prisma.webauthnCredential.findMany({ where: { userId } });
  if (creds.length === 0) return { kind: "no_credential" };

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c: { credentialId: string; transports: string | null }) => ({
      id: c.credentialId,
      transports: toTransports(c.transports),
    })),
    userVerification: "required",
  });
  await saveChallenge(userId, options.challenge);
  return { kind: "ok", options };
}

/**
 * Verifies a WebAuthn assertion belongs to `userId` and was signed just now
 * by one of their registered devices. This is the actual "is the person
 * tapping this button the account owner, physically present" check that
 * checkIn/checkOut (src/actions/attendance.ts) runs before touching
 * attendance data at all.
 */
export async function verifyAssertion(userId: string, response: AuthenticationResponseJSON): Promise<boolean> {
  const { rpID, origin } = getRpIdAndOrigin();
  const expectedChallenge = await takeChallenge(userId);
  if (!expectedChallenge) return false;

  const stored = await prisma.webauthnCredential.findUnique({ where: { credentialId: response.id } });
  if (!stored || stored.userId !== userId) return false;

  const credential: SimpleWebAuthnCredential = {
    id: stored.credentialId,
    publicKey: new Uint8Array(stored.publicKey),
    counter: stored.counter,
    transports: toTransports(stored.transports) as SimpleWebAuthnCredential["transports"],
  };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential,
      requireUserVerification: true,
    });
  } catch {
    return false;
  }
  if (!verification.verified) return false;

  await prisma.webauthnCredential.update({
    where: { id: stored.id },
    data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });
  return true;
}

// ---------------------------------------------------- passkey sign-in ----
//
// The same registered device credentials double as a passwordless login:
// the browser is asked for *any* passkey for this site ("discoverable"
// credential — no email typed first), and whichever one the person unlocks
// with Face ID/fingerprint tells us who they are via its credential ID.
// Because there's no user yet when the challenge is issued, it's stored
// under a random "login:<key>" pseudo-user in WebauthnChallenge and the key
// is handed to the client to bring back with the assertion.

function loginChallengeKey() {
  return `login:${randomBytes(18).toString("base64url")}`;
}

export async function buildLoginOptions(): Promise<{
  challengeKey: string;
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
}> {
  const { rpID } = getRpIdAndOrigin();
  const options = await generateAuthenticationOptions({
    rpID,
    // No allowCredentials → the authenticator offers every passkey it holds
    // for this rpID and the person picks (usually there's exactly one).
    userVerification: "required",
  });
  const challengeKey = loginChallengeKey();
  await saveChallenge(challengeKey, options.challenge);
  return { challengeKey, options };
}

/**
 * Verifies a discoverable-credential assertion and returns the owning
 * user's id, or null. The caller (src/actions/passkeyLogin.ts) turns that
 * into a one-time sign-in ticket for the "ticket" NextAuth provider.
 */
export async function verifyLoginAssertion(
  challengeKey: string,
  response: AuthenticationResponseJSON
): Promise<{ userId: string; credentialLabel: string | null } | null> {
  if (!challengeKey.startsWith("login:")) return null;
  const { rpID, origin } = getRpIdAndOrigin();
  const expectedChallenge = await takeChallenge(challengeKey);
  if (!expectedChallenge) return null;

  const stored = await prisma.webauthnCredential.findUnique({ where: { credentialId: response.id } });
  if (!stored) return null;

  const credential: SimpleWebAuthnCredential = {
    id: stored.credentialId,
    publicKey: new Uint8Array(stored.publicKey),
    counter: stored.counter,
    transports: toTransports(stored.transports) as SimpleWebAuthnCredential["transports"],
  };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential,
      requireUserVerification: true,
    });
  } catch {
    return null;
  }
  if (!verification.verified) return null;

  await prisma.webauthnCredential.update({
    where: { id: stored.id },
    data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
  });
  return { userId: stored.userId, credentialLabel: stored.label };
}
