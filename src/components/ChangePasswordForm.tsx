"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { changeOwnPassword, signOutEverywhere } from "@/actions/users";
import { useLanguage } from "@/components/LanguageProvider";
import AuthPageControls from "@/components/AuthPageControls";

/**
 * Client-side mirror of the server's password policy (src/lib/security.ts)
 * for the live strength meter only — the server re-checks everything.
 */
function scorePassword(pw: string, email: string): 0 | 1 | 2 | 3 {
  if (pw.length < 8) return 0;
  let score = 1;
  if (pw.length >= 12) score++;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (kinds >= 3) score++;
  if (/^(.)\1+$/.test(pw) || /^(?:12345678|password|qwerty)/i.test(pw)) return 1;
  const local = email.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && pw.toLowerCase().includes(local)) return 1;
  return Math.min(3, score) as 0 | 1 | 2 | 3;
}

export default function ChangePasswordForm({ forced, email }: { forced: boolean; email: string }) {
  const { dict } = useLanguage();
  const t = dict.changePassword;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [show, setShow] = useState(false);
  const [everywhereResult, setEverywhereResult] = useState<string | null>(null);

  const score = scorePassword(newPassword, email);
  const strengthLabel = [t.strengthTooShort, t.strengthWeak, t.strengthOk, t.strengthStrong][score];
  const strengthColor = ["bg-line-strong", "bg-danger", "bg-warn", "bg-ok"][score];

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await changeOwnPassword(null, formData);
      setResult(res);
      if (res.ok) {
        // Changing the password bumps the account's session version, which
        // invalidates this browser's JWT too. The action hands back a
        // one-shot ticket so we can re-establish the session here without
        // making the person log in again; fall back to a clean sign-out.
        if (res.ticket) {
          const r = await signIn("ticket", { ticket: res.ticket, redirect: false });
          if (!r?.error) {
            router.push("/dashboard");
            router.refresh();
            return;
          }
        }
        signOut({ callbackUrl: "/login" });
      }
    });
  }

  function onSignOutEverywhere() {
    if (!confirm(t.signOutEverywhereConfirm)) return;
    startTransition(async () => {
      const res = await signOutEverywhere();
      setEverywhereResult(res.message);
      if (res.ok) signOut({ callbackUrl: "/login" });
    });
  }

  const inputType = show ? "text" : "password";

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

        <h1 className="mb-1 text-lg font-bold">{forced ? t.title : t.titleSelf}</h1>
        <p className="mb-6 text-sm text-muted">{forced ? t.subtitle : t.subtitleSelf}</p>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {!forced && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">{t.currentPassword}</label>
              <input name="currentPassword" type={inputType} required autoComplete="current-password" className="input" />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{t.newPassword}</label>
            <input
              name="newPassword"
              type={inputType}
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input"
              placeholder={t.newPasswordPlaceholder}
            />
            <div className="mt-1 flex items-center gap-2">
              <div className="flex flex-1 gap-1">
                {[1, 2, 3].map((i) => (
                  <span key={i} className={`h-1.5 flex-1 rounded-full ${score >= i ? strengthColor : "bg-line-soft"}`} />
                ))}
              </div>
              <span className="w-24 text-right text-[11px] text-faint">{newPassword ? strengthLabel : ""}</span>
            </div>
            <p className="text-[11px] text-faint">{t.policyHint}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{t.confirmPassword}</label>
            <input name="confirm" type={inputType} required minLength={8} autoComplete="new-password" className="input" />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            {t.showPasswords}
          </label>
          {result && !result.ok && <p className="text-sm text-danger">{result.message}</p>}
          <button
            type="submit"
            disabled={pending}
            className="mt-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? t.submitting : t.submit}
          </button>
          <Link href="/dashboard" className="text-center text-xs font-medium text-muted hover:text-ink">
            {forced ? t.later : dict.common.cancel}
          </Link>
        </form>
      </div>

      {!forced && (
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-sm font-bold">{t.securityTitle}</h2>
          <p className="mt-1 text-xs text-muted">{t.signOutEverywhereHint}</p>
          <button
            onClick={onSignOutEverywhere}
            disabled={pending}
            className="mt-3 rounded-lg border border-danger px-3 py-1.5 text-xs font-semibold text-danger disabled:opacity-60"
          >
            {t.signOutEverywhere}
          </button>
          {everywhereResult && <p className="mt-2 text-xs text-muted">{everywhereResult}</p>}
        </div>
      )}
    </div>
  );
}
