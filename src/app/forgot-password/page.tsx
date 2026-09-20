"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/actions/passwordReset";
import { useLanguage } from "@/components/LanguageProvider";
import AuthPageControls from "@/components/AuthPageControls";

/** Public "forgot password" — enter username or email, get a reset link by email (src/actions/passwordReset.ts). */
export default function ForgotPasswordPage() {
  const { dict } = useLanguage();
  const t = dict.forgot;
  const [identifier, setIdentifier] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      setResult(await requestPasswordReset(identifier));
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 pt-16">
      <AuthPageControls />
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">TS</div>
          <div>
            <div className="text-base font-bold leading-tight">{dict.appName}</div>
            <div className="text-xs text-muted">{dict.appTagline}</div>
          </div>
        </div>

        <h1 className="mb-1 text-lg font-bold">{t.title}</h1>
        <p className="mb-6 text-sm text-muted">{t.subtitle}</p>

        {result?.ok ? (
          <div className="rounded-lg bg-ok-soft p-4 text-sm text-ok">
            <p className="font-medium">{result.message}</p>
            <p className="mt-2 text-xs opacity-80">{t.checkSpam}</p>
          </div>
        ) : (
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
            {result && !result.ok && <p className="text-sm text-danger">{result.message}</p>}
            <button type="submit" disabled={pending} className="mt-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? t.sending : t.submit}
            </button>
          </form>
        )}

        <Link href="/login" className="mt-5 block text-center text-xs font-medium text-muted hover:text-ink">
          {t.backToLogin}
        </Link>
      </div>
    </div>
  );
}
