"use client";

import { useEffect } from "react";
import { useLanguage } from "@/components/LanguageProvider";

/**
 * Friendly fallback for anything that still throws inside the app shell —
 * a card with a retry button and a way home, instead of Next's bare
 * "Application error: a server-side exception has occurred".
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { dict } = useLanguage();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto mt-10 max-w-md rounded-2xl border border-danger bg-danger-soft p-6 text-center">
      <h1 className="text-base font-bold text-danger">{dict.errorPage.title}</h1>
      <p className="mt-2 text-sm text-danger opacity-90">{dict.errorPage.hint}</p>
      {error.digest && <p className="mt-2 font-mono text-[11px] text-danger opacity-70">ref: {error.digest}</p>}
      <div className="mt-4 flex justify-center gap-2">
        <button onClick={reset} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
          {dict.errorPage.retry}
        </button>
        <a href="/checkin" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink">
          {dict.errorPage.home}
        </a>
      </div>
    </div>
  );
}
