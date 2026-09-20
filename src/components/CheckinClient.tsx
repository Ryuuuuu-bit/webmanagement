"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { checkIn, checkOut, type IdentityVerification } from "@/actions/attendance";
import { startWebauthnVerification } from "@/actions/webauthn";
import type { CheckinPolicy } from "@/lib/settings";
import { useLanguage } from "./LanguageProvider";
import SelfieCapture from "./SelfieCapture";
import { getDeviceId } from "@/lib/deviceId";

type Attendance = {
  status: string;
  checkinAt: string | null;
  checkoutAt: string | null;
} | null;

type Coords = { lat: number; lng: number };
type ActionKind = "checkin" | "checkout";
export type CredentialState = "none" | "pending" | "approved";

/**
 * Check-in/out flow: GPS (prefetched) → selfie (if policy) → Face ID /
 * fingerprint (registered + approved device) → submit. With the biometric
 * policy on there is no password path at all; the buttons explain what's
 * missing (no device yet / device awaiting approval) instead. The password
 * prompt only exists for the policy-off case AND an account with no device.
 * See src/actions/attendance.ts for the server-side rules.
 */
export default function CheckinClient({
  attendance,
  credentialState,
  policy,
}: {
  attendance: Attendance;
  credentialState: CredentialState;
  policy: CheckinPolicy;
}) {
  const { dict } = useLanguage();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locatingFallback, setLocatingFallback] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const coordsRef = useRef<Coords | null>(null);

  // Selfie step state: which action is waiting for a photo.
  const [selfieFor, setSelfieFor] = useState<{ kind: ActionKind; lat: number; lng: number } | null>(null);

  // Password path (policy off + no device only).
  const [pendingAction, setPendingAction] = useState<{ kind: ActionKind; lat: number; lng: number; selfie: string | null } | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const canCheckin = !attendance?.checkinAt;
  const canCheckout = !!attendance?.checkinAt && !attendance?.checkoutAt;
  const busy = pending || locatingFallback || verifying || passwordBusy || !!pendingAction || !!selfieFor;

  // The biometric policy blocks anyone without an approved device outright.
  const blockedReason: string | null =
    policy.requireBiometricCheckin && credentialState !== "approved"
      ? credentialState === "pending"
        ? dict.checkin.blockedPending
        : dict.checkin.blockedNoDevice
      : null;

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        coordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  function submit(kind: ActionKind, lat: number, lng: number, verification: IdentityVerification, selfie: string | null) {
    const action = kind === "checkin" ? checkIn : checkOut;
    startTransition(async () => {
      const res = await action(lat, lng, verification, { deviceId: getDeviceId(), selfie });
      setMessage({ ok: res.ok, text: res.message });
    });
  }

  /** Biometric prompt (must run inside a user gesture), then submit. */
  async function verifyAndSubmit(kind: ActionKind, lat: number, lng: number, selfie: string | null) {
    if (credentialState === "approved" && browserSupportsWebAuthn()) {
      setVerifying(true);
      try {
        const optionsResult = await startWebauthnVerification();
        if (optionsResult.kind === "ok") {
          const assertion = await startAuthentication({ optionsJSON: optionsResult.options });
          setVerifying(false);
          submit(kind, lat, lng, { method: "webauthn", assertion }, selfie);
          return;
        }
      } catch {
        // Cancelled / failed prompt. Under the biometric policy that's the
        // end of it — no password fallback — so say so and stop.
      }
      setVerifying(false);
      if (policy.requireBiometricCheckin) {
        setMessage({ ok: false, text: dict.checkin.biometricCancelled });
        return;
      }
    }
    if (policy.requireBiometricCheckin) {
      setMessage({ ok: false, text: blockedReason ?? dict.checkin.blockedNoDevice });
      return;
    }
    if (credentialState !== "none") {
      // Policy off but a device exists: it must be used — no password.
      setMessage({ ok: false, text: dict.checkin.biometricCancelled });
      return;
    }
    setPasswordError(null);
    setPendingAction({ kind, lat, lng, selfie });
  }

  function afterLocation(kind: ActionKind, lat: number, lng: number) {
    if (policy.requireSelfieCheckin) {
      setSelfieFor({ kind, lat, lng });
      return;
    }
    verifyAndSubmit(kind, lat, lng, null);
  }

  function run(kind: ActionKind) {
    setGeoError(null);
    setMessage(null);
    if (blockedReason) {
      setMessage({ ok: false, text: blockedReason });
      return;
    }
    if (coordsRef.current) {
      afterLocation(kind, coordsRef.current.lat, coordsRef.current.lng);
      return;
    }
    if (!("geolocation" in navigator)) {
      setGeoError(dict.checkin.geoUnsupported);
      return;
    }
    setLocatingFallback(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocatingFallback(false);
        coordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        afterLocation(kind, pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLocatingFallback(false);
        setGeoError(dict.checkin.geoError);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function onSelfieConfirmed(dataUrl: string) {
    if (!selfieFor) return;
    const { kind, lat, lng } = selfieFor;
    setSelfieFor(null);
    // Same tap as "use this photo" — keeps the user gesture for WebAuthn.
    verifyAndSubmit(kind, lat, lng, dataUrl);
  }

  function onConfirmPassword() {
    if (!pendingAction) return;
    const { kind, lat, lng, selfie } = pendingAction;
    const action = kind === "checkin" ? checkIn : checkOut;
    setPasswordBusy(true);
    setPasswordError(null);
    startTransition(async () => {
      const res = await action(lat, lng, { method: "password", password }, { deviceId: getDeviceId(), selfie });
      setPasswordBusy(false);
      if (res.ok) {
        setPendingAction(null);
        setPassword("");
        setMessage({ ok: true, text: res.message });
      } else {
        setPasswordError(res.message);
      }
    });
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex gap-3">
        <button
          onClick={() => run("checkin")}
          disabled={busy || !canCheckin || !!blockedReason}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          📍 {dict.checkin.checkinButton}
        </button>
        <button
          onClick={() => run("checkout")}
          disabled={busy || !canCheckout || !!blockedReason}
          className="rounded-lg border border-line-strong px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
        >
          🚪 {dict.checkin.checkoutButton}
        </button>
      </div>

      {blockedReason && (
        <div className="w-full max-w-xs rounded-xl border border-warn bg-warn-soft p-3 text-left text-xs text-warn">
          <p className="font-semibold">{blockedReason}</p>
          {credentialState === "none" && <p className="mt-1 opacity-90">{dict.checkin.blockedNoDeviceHint}</p>}
          {credentialState === "pending" && <p className="mt-1 opacity-90">{dict.checkin.blockedPendingHint}</p>}
          <a href="#devices" className="mt-2 inline-block font-semibold underline">
            {dict.checkin.goRegisterDevice}
          </a>
        </div>
      )}

      {(pending || locatingFallback) && <p className="text-xs text-faint">{dict.checkin.locating}</p>}
      {verifying && <p className="text-xs text-faint">{dict.checkin.verifyingIdentity}</p>}
      {message && <p className={`text-sm font-medium ${message.ok ? "text-brand-ink" : "text-danger"}`}>{message.text}</p>}
      {geoError && <p className="text-sm text-danger">{geoError}</p>}
      <p className="max-w-xs text-xs text-faint">
        {policy.requireSelfieCheckin ? dict.checkin.helpTextSelfie : dict.checkin.helpText}
      </p>

      {selfieFor && <SelfieCapture kind={selfieFor.kind} onConfirm={onSelfieConfirmed} onCancel={() => setSelfieFor(null)} />}

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
              onClick={() => {
                setPendingAction(null);
                setPassword("");
                setPasswordError(null);
              }}
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
