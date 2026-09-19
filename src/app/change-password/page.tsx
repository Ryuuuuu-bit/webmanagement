"use client";

import { useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import { changeOwnPassword } from "@/actions/users";
import { useLanguage } from "@/components/LanguageProvider";

export default function ChangePasswordPage() {
  const { dict } = useLanguage();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await changeOwnPassword(null, formData);
      setResult(res);
      if (res.ok) {
        // Changing the password bumps the account's session version, so this
        // browser's own session is invalidated too — sign out cleanly and
        // send them to log back in with the new password.
        signOut({ callbackUrl: "/login" });
      }
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">TS</div>
          <div>
            <div className="text-base font-bold leading-tight">{dict.appName}</div>
            <div className="text-xs text-muted">{dict.appTagline}</div>
          </div>
        </div>

        <h1 className="mb-1 text-lg font-bold">{dict.changePassword.title}</h1>
        <p className="mb-6 text-sm text-muted">{dict.changePassword.subtitle}</p>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{dict.changePassword.newPassword}</label>
            <input
              name="newPassword"
              type="password"
              required
              minLength={8}
              className="input"
              placeholder={dict.changePassword.newPasswordPlaceholder}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{dict.changePassword.confirmPassword}</label>
            <input
              name="confirm"
              type="password"
              required
              minLength={8}
              className="input"
            />
          </div>
          {result && !result.ok && <p className="text-sm text-danger">{result.message}</p>}
          <button
            type="submit"
            disabled={pending}
            className="mt-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? dict.changePassword.submitting : dict.changePassword.submit}
          </button>
        </form>
      </div>
    </div>
  );
}
