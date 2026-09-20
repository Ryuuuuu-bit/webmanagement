"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { startPasskeyLogin, finishPasskeyLogin } from "@/actions/passkeyLogin";
import { useLanguage } from "@/components/LanguageProvider";
import InstallPrompt from "@/components/InstallPrompt";
import AuthPageControls from "@/components/AuthPageControls";
import { hasPasskeyHint, rememberPasskeyHint } from "@/lib/passkeyHint";

/** Only ever send people to a same-site path after login — never an absolute URL from the query string. */
function safeCallback(raw: string | null, fallback: string) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const { dict } = useLanguage();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const autoTried = useRef(false);

  const callbackUrl = safeCallback(search.get("callbackUrl"), "/dashboard");

  function finish() {
    router.push(callbackUrl);
    router.refresh();
  }

  function describeError(code: string | undefined) {
    if (!code) return dict.login.invalidCredentials;
    if (code.startsWith("TOO_MANY_ATTEMPTS")) {
      const minutes = Number(code.split(":")[1]) || 15;
      return dict.login.tooManyAttempts(minutes);
    }
    if (code === "ACCOUNT_SUSPENDED") return dict.login.suspended;
    if (code === "TEMP_PASSWORD_EXPIRED") return dict.login.tempExpired;
    return dict.login.invalidCredentials;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", { identifier, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError(describeError(res.error));
      return;
    }
    finish();
  }

  async function onPasskey(auto = false) {
    setError(null);
    setPasskeyBusy(true);
    try {
      const { challengeKey, options } = await startPasskeyLogin();
      const assertion = await startAuthentication({ optionsJSON: options });
      const result = await finishPasskeyLogin(challengeKey, assertion);
      if (!result.ok) {
        setError(result.reason === "suspended" ? dict.login.suspended : dict.login.passkeyFailed);
        return;
      }
      const res = await signIn("ticket", { ticket: result.ticket, redirect: false });
      if (res?.error) {
        setError(describeError(res.error));
        return;
      }
      rememberPasskeyHint();
      finish();
    } catch {
      // Cancelled the system prompt, or no passkey on this device for this
      // site. Silent when it was our automatic attempt — the password form
      // is right there — but say so when the person tapped the button.
      if (!auto) setError(dict.login.passkeyCancelled);
    } finally {
      setPasskeyBusy(false);
    }
  }

  useEffect(() => {
    const supported = browserSupportsWebAuthn();
    setPasskeySupported(supported);
    if (supported && hasPasskeyHint() && !autoTried.current) {
      autoTried.current = true;
      onPasskey(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        <h1 className="mb-1 text-lg font-bold">{dict.login.title}</h1>
        <p className="mb-5 text-sm text-muted">{dict.login.subtitle}</p>

        {passkeySupported && (
          <>
            <button
              type="button"
              onClick={() => onPasskey(false)}
              disabled={passkeyBusy || loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand bg-brand-soft px-4 py-2.5 text-sm font-semibold text-brand-ink disabled:opacity-60"
            >
              <FingerprintIcon />
              {passkeyBusy ? dict.login.passkeyWaiting : dict.login.passkeyButton}
            </button>
            <p className="mt-1.5 text-center text-[11px] text-faint">{dict.login.passkeyHint}</p>
            <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-faint">
              <span className="h-px flex-1 bg-line" />
              {dict.login.orPassword}
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{dict.login.identifier}</label>
            <input
              type="text"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="input"
              placeholder={dict.login.identifierPlaceholder}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">{dict.login.password}</label>
              <span className="text-[11px] text-faint">{dict.login.forgotHint}</span>
            </div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full pr-16"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs font-medium text-muted hover:text-ink"
                aria-pressed={showPassword}
              >
                {showPassword ? dict.login.hidePassword : dict.login.showPassword}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={loading || passkeyBusy}
            className="mt-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? dict.login.submitting : dict.login.submit}
          </button>
        </form>
      </div>

      <div className="w-full max-w-sm">
        <InstallPrompt />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function FingerprintIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 11a1 1 0 0 0-1 1v3a4 4 0 0 0 2 3.5" />
      <path d="M8 12a4 4 0 0 1 8 0v1a7 7 0 0 0 1 3.5" />
      <path d="M5.5 14a8 8 0 0 1-.5-2.5 7 7 0 0 1 12.2-4.7" />
      <path d="M19.5 9.5A9.9 9.9 0 0 1 20 12c0 1.8-.4 3.4-1 4.9" />
      <path d="M7 18.5a10 10 0 0 1-1-2" />
      <path d="M4.2 8.5A9.9 9.9 0 0 1 12 3c1.4 0 2.7.3 3.9.8" />
    </svg>
  );
}
