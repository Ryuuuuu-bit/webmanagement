"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completePasswordReset, type ResetPreview } from "@/actions/passwordReset";
import { useLanguage } from "./LanguageProvider";
import AuthPageControls from "./AuthPageControls";

export default function ResetPasswordClient({ token, preview }: { token: string; preview: ResetPreview }) {
  const { dict } = useLanguage();
  const t = dict.reset;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await completePasswordReset(token, newPassword, confirm);
      setResult(res);
      if (res.ok) setTimeout(() => router.push("/login"), 1500);
    });
  }

  const inputType = show ? "text" : "password";

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

        {preview.status !== "ok" ? (
          <>
            <h1 className="mb-1 text-lg font-bold">{t.badLinkTitle}</h1>
            <p className="text-sm text-muted">{preview.status === "used" ? t.used : preview.status === "expired" ? t.expired : t.invalid}</p>
            <Link href="/forgot-password" className="mt-6 block rounded-lg bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white">
              {t.requestAgain}
            </Link>
          </>
        ) : result?.ok ? (
          <div className="rounded-lg bg-ok-soft p-4 text-sm text-ok">
            <p className="font-medium">{result.message}</p>
            <p className="mt-1 text-xs opacity-80">{t.redirecting}</p>
          </div>
        ) : (
          <>
            <h1 className="mb-1 text-lg font-bold">{preview.purpose === "setup" ? t.titleSetup : t.title}</h1>
            <p className="mb-6 text-sm text-muted">{t.subtitle(preview.name)}</p>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">{dict.changePassword.newPassword}</label>
                <input
                  type={inputType}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input"
                  placeholder={dict.changePassword.newPasswordPlaceholder}
                />
                <p className="text-[11px] text-faint">{dict.changePassword.policyHint}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">{dict.changePassword.confirmPassword}</label>
                <input type={inputType} required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input" />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
                {dict.changePassword.showPasswords}
              </label>
              {result && !result.ok && <p className="text-sm text-danger">{result.message}</p>}
              <button type="submit" disabled={pending} className="mt-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {pending ? dict.changePassword.submitting : t.submit}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
