"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { redeemEnrollment, type EnrollmentPreview } from "@/actions/enrollment";
import { startWebauthnRegistration, finishWebauthnRegistration } from "@/actions/webauthn";
import { rememberPasskeyHint } from "@/lib/passkeyHint";
import { useLanguage } from "./LanguageProvider";
import InstallPrompt from "./InstallPrompt";
import AuthPageControls from "./AuthPageControls";

type Step = "confirm" | "passkey" | "done";

/**
 * Three-step "link this phone" flow after scanning an Admin's enrollment
 * QR: (1) confirm and sign in via the one-time ticket, (2) register this
 * phone's Face ID/fingerprint as a passkey so future opens need no
 * password, (3) point them at check-in and the add-to-home-screen guide.
 */
export default function EnrollClient({ token, preview }: { token: string; preview: EnrollmentPreview }) {
  const { dict } = useLanguage();
  const t = dict.enroll;
  const [step, setStep] = useState<Step>("confirm");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyDone, setPasskeyDone] = useState(false);

  async function onLink() {
    setBusy(true);
    setError(null);
    try {
      const res = await redeemEnrollment(token);
      if (!res.ok) {
        setError(res.status === "used" ? t.used : res.status === "expired" ? t.expired : t.invalid);
        return;
      }
      const signed = await signIn("ticket", { ticket: res.ticket, redirect: false });
      if (signed?.error) {
        setError(t.invalid);
        return;
      }
      setStep(browserSupportsWebAuthn() ? "passkey" : "done");
    } finally {
      setBusy(false);
    }
  }

  async function onRegisterPasskey() {
    setBusy(true);
    setError(null);
    try {
      const options = await startWebauthnRegistration();
      const response = await startRegistration({ optionsJSON: options });
      const res = await finishWebauthnRegistration(response, t.defaultDeviceLabel);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      rememberPasskeyHint();
      setPasskeyDone(true);
      setStep("done");
    } catch {
      setError(t.passkeyCancelled);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 pt-16">
      <AuthPageControls />
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">TS</div>
          <div>
            <div className="text-base font-bold leading-tight">{dict.appName}</div>
            <div className="text-xs text-muted">{dict.appTagline}</div>
          </div>
        </div>

        {preview.status !== "ok" ? (
          <>
            <h1 className="mb-1 text-lg font-bold">{t.badLinkTitle}</h1>
            <p className="text-sm text-muted">
              {preview.status === "used" ? t.used : preview.status === "expired" ? t.expired : t.invalid}
            </p>
            <Link href="/login" className="mt-6 block rounded-lg bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white">
              {t.goLogin}
            </Link>
          </>
        ) : step === "confirm" ? (
          <>
            <h1 className="mb-1 text-lg font-bold">{t.title}</h1>
            <p className="mb-5 text-sm text-muted">{t.subtitle}</p>
            <div className="rounded-lg border border-line-soft bg-page px-4 py-3 text-sm">
              <div className="font-semibold">{preview.userName}</div>
              <div className="text-xs text-muted">{preview.userEmail}</div>
            </div>
            <p className="mt-3 text-xs text-faint">{t.notYouHint}</p>
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
            <button
              onClick={onLink}
              disabled={busy}
              className="mt-5 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? t.linking : t.linkButton}
            </button>
          </>
        ) : step === "passkey" ? (
          <>
            <StepBadge n={2} label={t.stepPasskey} />
            <h1 className="mb-1 text-lg font-bold">{t.passkeyTitle}</h1>
            <p className="mb-5 text-sm text-muted">{t.passkeySubtitle}</p>
            {error && <p className="mb-3 text-sm text-danger">{error}</p>}
            <button
              onClick={onRegisterPasskey}
              disabled={busy}
              className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? t.passkeyWaiting : t.passkeyButton}
            </button>
            <button onClick={() => setStep("done")} disabled={busy} className="mt-2 w-full px-4 py-2 text-xs font-medium text-muted hover:text-ink">
              {t.skipForNow}
            </button>
          </>
        ) : (
          <>
            <StepBadge n={3} label={t.stepDone} />
            <h1 className="mb-1 text-lg font-bold">{t.doneTitle}</h1>
            <p className="mb-5 text-sm text-muted">{passkeyDone ? t.doneWithPasskey : t.doneWithoutPasskey}</p>
            <Link href="/checkin" className="block rounded-lg bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white">
              {t.goCheckin}
            </Link>
          </>
        )}
      </div>

      {step === "done" && (
        <div className="w-full max-w-sm">
          <InstallPrompt forceShow />
        </div>
      )}
    </div>
  );
}

function StepBadge({ n, label }: { n: number; label: string }) {
  return (
    <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand-ink">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[10px] text-white">{n}</span>
      {label}
    </div>
  );
}
