"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { acceptConsent } from "@/actions/consent";
import { useLanguage } from "./LanguageProvider";
import AuthPageControls from "./AuthPageControls";

export default function ConsentClient({ version }: { version: string }) {
  const { dict } = useLanguage();
  const t = dict.consent;
  const router = useRouter();
  const [agree, setAgree] = useState(false);
  const [pending, startTransition] = useTransition();

  function onAccept() {
    startTransition(async () => {
      const res = await acceptConsent();
      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 pt-16">
      <AuthPageControls />
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">TS</div>
          <div>
            <div className="text-base font-bold leading-tight">{dict.appName}</div>
            <div className="text-xs text-muted">{dict.appTagline}</div>
          </div>
        </div>
        <h1 className="text-lg font-bold">{t.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.intro}</p>

        <div className="mt-4 max-h-[50vh] overflow-y-auto rounded-xl border border-line bg-page p-4 text-sm leading-relaxed">
          {t.sections.map((s) => (
            <section key={s.heading} className="mb-3 last:mb-0">
              <h2 className="font-semibold text-ink">{s.heading}</h2>
              <p className="mt-0.5 text-subtle">{s.body}</p>
            </section>
          ))}
          <p className="mt-3 text-[11px] text-faint">{t.version(version)}</p>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
          <span>{t.agreeLabel}</span>
        </label>

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-subtle">
            {t.decline}
          </button>
          <button type="button" disabled={!agree || pending} onClick={onAccept} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? dict.common.saving : t.accept}
          </button>
        </div>
        <p className="mt-3 text-[11px] text-faint">{t.declineHint}</p>
      </div>
    </div>
  );
}
