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
 * fingerprint (only when the biometric policy is on; registered + approved
 * device) → submit. Policy off = no identity prompt at all. The tiles
 * explain what's missing (no device yet / device awaiting approval).
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
  const { dict, locale } = useLanguage();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locatingFallback, setLocatingFallback] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const coordsRef = useRef<Coords | null>(null);

  // Selfie step state: which action is waiting for a photo.
  const [selfieFor, setSelfieFor] = useState<{ kind: ActionKind; lat: number; lng: number } | null>(null);


  const canCheckin = !attendance?.checkinAt;
  const canCheckout = !!attendance?.checkinAt && !attendance?.checkoutAt;
  const busy = pending || locatingFallback || verifying || !!selfieFor;

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

  /** Biometric prompt (must run inside a user gesture) when the policy demands it; otherwise the session is enough. */
  async function verifyAndSubmit(kind: ActionKind, lat: number, lng: number, selfie: string | null) {
    if (!policy.requireBiometricCheckin) {
      // Policy off: no extra prompt at all — being signed in (password or
      // passkey) is the identity check. Selfie/GPS rules still applied above.
      submit(kind, lat, lng, { method: "session" }, selfie);
      return;
    }
    if (credentialState !== "approved" || !browserSupportsWebAuthn()) {
      setMessage({ ok: false, text: blockedReason ?? dict.checkin.blockedNoDevice });
      return;
    }
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
      // Cancelled / failed prompt — under the biometric policy that's the end of it.
    }
    setVerifying(false);
    setMessage({ ok: false, text: dict.checkin.biometricCancelled });
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

  const doneIn = !!attendance?.checkinAt;
  const doneOut = !!attendance?.checkoutAt;
  const timeOf = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleTimeString(locale === "en" ? "en-US" : "th-TH", { hour: "2-digit", minute: "2-digit", hour12: locale === "en", timeZone: "Asia/Bangkok" }) : null;

  // Two big tap targets. The one that's "next" is filled and gently pulses;
  // a finished step turns into a quiet receipt with its time; the other is
  // outlined and waits. Disabled states keep their shape (no layout jump).
  const tile = (kind: ActionKind) => {
    const isIn = kind === "checkin";
    const done = isIn ? doneIn : doneOut;
    const enabled = !busy && !blockedReason && (isIn ? canCheckin : canCheckout);
    const next = enabled;
    const label = isIn ? dict.checkin.checkinButton : dict.checkin.checkoutButton;
    const sub = done
      ? `${dict.checkin.tileDone} ${timeOf(isIn ? attendance?.checkinAt : attendance?.checkoutAt) ?? ""}`
      : blockedReason
        ? dict.checkin.tileBlocked
        : busy
          ? dict.checkin.tileBusy
          : next
            ? dict.checkin.tileTap
            : dict.checkin.tileWaitOut;
    const base = "relative flex flex-col items-center justify-center gap-1.5 rounded-2xl px-3 py-5 text-center transition-all duration-150 select-none";
    const look = done
      ? "border border-ok bg-ok-soft text-ok"
      : next
        ? isIn
          ? "text-white shadow-lg active:scale-[0.97]"
          : "text-white shadow-lg active:scale-[0.97]"
        : "border border-line bg-surface text-faint";
    const style: React.CSSProperties | undefined = !done && next
      ? isIn
        ? { background: "linear-gradient(135deg, var(--color-brand) 0%, var(--color-brand-ink) 100%)" }
        : { background: "linear-gradient(135deg, #d97706 0%, #b45309 100%)" }
      : undefined;
    return (
      <button type="button" onClick={() => run(kind)} disabled={!enabled} className={`${base} ${look} disabled:cursor-not-allowed`} style={style} aria-label={label}>
        {next && <span className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-white/30 animate-[pulseRing_2s_ease-out_infinite]" aria-hidden />}
        <span className={`flex h-12 w-12 items-center justify-center rounded-full ${done ? "bg-ok text-white" : next ? "bg-white/20" : "bg-line-soft"}`}>
          {done ? <CheckIcon /> : isIn ? <EnterIcon /> : <ExitIcon />}
        </span>
        <span className="text-base font-bold leading-tight">{label}</span>
        <span className={`text-[11px] leading-tight ${done ? "opacity-90" : next ? "text-white/85" : ""}`}>{sub}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="grid w-full max-w-sm grid-cols-2 gap-3">
        {tile("checkin")}
        {tile("checkout")}
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

    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
function EnterIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M4 12h11" />
      <path d="M11 8l4 4-4 4" />
    </svg>
  );
}
function ExitIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M20 12H9" />
      <path d="M16 8l4 4-4 4" />
    </svg>
  );
}
