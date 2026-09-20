"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { checkIn, checkOut, type IdentityVerification } from "@/actions/attendance";
import { startWebauthnVerification } from "@/actions/webauthn";
import { useLanguage } from "./LanguageProvider";

type Attendance = {
  status: string;
  checkinAt: string | null;
  checkoutAt: string | null;
} | null;

type Coords = { lat: number; lng: number };
type ActionKind = "checkin" | "checkout";

/**
 * Anti "buddy punching" (ฝากเช็คอิน/เช็คเอาต์แทนกัน): every check-in/out now
 * requires a fresh identity check right before it's submitted — the
 * teacher's own device fingerprint/Face ID (WebAuthn) if they've registered
 * one on this account, otherwise their account password as a fallback (for
 * a device without platform biometrics, or before they've registered one
 * yet). See src/lib/webauthn.ts and src/actions/attendance.ts.
 */
export default function CheckinClient({
  attendance,
  hasCredential,
}: {
  attendance: Attendance;
  hasCredential: boolean;
}) {
  const { dict } = useLanguage();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  // True only during the rare fallback below (background GPS fetch not
  // ready yet) — the normal fast path never waits on GPS at all.
  const [locatingFallback, setLocatingFallback] = useState(false);
  // True while a WebAuthn (biometric) prompt is in flight.
  const [verifying, setVerifying] = useState(false);
  // Holds the most recent GPS fix obtained in the background (see the
  // effect below). A ref, not state: updates on every fix while the watch
  // runs, and reading it doesn't need to trigger a re-render.
  const coordsRef = useRef<Coords | null>(null);

  // Password-fallback prompt: set only when biometric verification isn't
  // available or didn't succeed, holding the check-in/out that's waiting on
  // a password to complete.
  const [pendingAction, setPendingAction] = useState<{ kind: ActionKind; lat: number; lng: number } | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const canCheckin = !attendance?.checkinAt;
  const canCheckout = !!attendance?.checkinAt && !attendance?.checkoutAt;
  const busy = pending || locatingFallback || verifying || passwordBusy || !!pendingAction;

  // Start reading the device's GPS position as soon as this page opens,
  // instead of waiting until the teacher taps check-in/out — see the
  // background-prefetch note in the git history for why. `watchPosition`
  // keeps refining/refreshing the fix for as long as the page stays open.
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        coordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
      () => {
        // Silent — surfaced only if the teacher taps a button and we still
        // have nothing (handled in run() below).
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  function submitWithVerification(kind: ActionKind, lat: number, lng: number, verification: IdentityVerification) {
    const action = kind === "checkin" ? checkIn : checkOut;
    startTransition(async () => {
      const res = await action(lat, lng, verification);
      setMessage(res.message);
    });
  }

  /** Runs the identity check (biometric, falling back to password) for a check-in/out whose GPS position we already have. */
  async function verifyAndSubmit(kind: ActionKind, lat: number, lng: number) {
    if (hasCredential && browserSupportsWebAuthn()) {
      setVerifying(true);
      try {
        const optionsResult = await startWebauthnVerification();
        if (optionsResult.kind === "ok") {
          const assertion = await startAuthentication({ optionsJSON: optionsResult.options });
          setVerifying(false);
          submitWithVerification(kind, lat, lng, { method: "webauthn", assertion });
          return;
        }
      } catch {
        // Prompt cancelled, no matching credential on this device, timed
        // out, etc. — fall through to the password prompt rather than
        // leaving the teacher stuck with no way to check in/out.
      }
      setVerifying(false);
    }
    setPasswordError(null);
    setPendingAction({ kind, lat, lng });
  }

  function run(kind: ActionKind) {
    setGeoError(null);
    setMessage(null);

    // Fast path: a position was already fetched in the background while the
    // page was open — go straight to identity verification, no GPS wait.
    if (coordsRef.current) {
      verifyAndSubmit(kind, coordsRef.current.lat, coordsRef.current.lng);
      return;
    }

    // Fallback: the background fetch hasn't returned a fix yet.
    if (!("geolocation" in navigator)) {
      setGeoError(dict.checkin.geoUnsupported);
      return;
    }
    setLocatingFallback(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocatingFallback(false);
        coordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        verifyAndSubmit(kind, pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLocatingFallback(false);
        setGeoError(dict.checkin.geoError);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function onConfirmPassword() {
    if (!pendingAction) return;
    const { kind, lat, lng } = pendingAction;
    const action = kind === "checkin" ? checkIn : checkOut;
    setPasswordBusy(true);
    setPasswordError(null);
    startTransition(async () => {
      const res = await action(lat, lng, { method: "password", password });
      setPasswordBusy(false);
      if (res.ok) {
        setPendingAction(null);
        setPassword("");
        setMessage(res.message);
      } else {
        setPasswordError(res.message);
      }
    });
  }

  function onCancelPassword() {
    setPendingAction(null);
    setPassword("");
    setPasswordError(null);
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex gap-3">
        <button
          onClick={() => run("checkin")}
          disabled={busy || !canCheckin}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          📍 {dict.checkin.checkinButton}
        </button>
        <button
          onClick={() => run("checkout")}
          disabled={busy || !canCheckout}
          className="rounded-lg border border-line-strong px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
        >
          🚪 {dict.checkin.checkoutButton}
        </button>
      </div>
      {(pending || locatingFallback) && <p className="text-xs text-faint">{dict.checkin.locating}</p>}
      {verifying && <p className="text-xs text-faint">{dict.checkin.verifyingIdentity}</p>}
      {message && <p className="text-sm font-medium text-brand-ink">{message}</p>}
      {geoError && <p className="text-sm text-danger">{geoError}</p>}
      <p className="max-w-xs text-xs text-faint">
        {dict.checkin.helpText}
      </p>

      {pendingAction && (
        <div className="mt-1 w-full max-w-xs rounded-xl border border-line-strong bg-surface p-4 text-left shadow-sm">
          <p className="text-sm font-bold">{dict.checkin.passwordPromptTitle}</p>
          <p className="mt-1 text-xs text-muted">{dict.checkin.passwordPromptHint}</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={dict.checkin.passwordFieldPlaceholder}
            className="input mt-3 w-full"
            disabled={passwordBusy}
            autoFocus
          />
          {passwordError && <p className="mt-2 text-xs text-danger">{passwordError}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={onCancelPassword}
              disabled={passwordBusy}
              className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            >
              {dict.checkin.cancelButton}
            </button>
            <button
              onClick={onConfirmPassword}
              disabled={passwordBusy || !password}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {passwordBusy ? dict.checkin.verifyingIdentity : dict.checkin.confirmButton}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
