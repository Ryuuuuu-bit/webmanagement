"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import { formatDate } from "@/lib/date";

/**
 * Shown on every page while the account is still on its Admin-issued
 * temporary password. Not dismissable on purpose — it disappears the moment
 * they set their own password (or enrol a device via QR, which also clears
 * the flag). Warns about the expiry date because after it the temporary
 * password stops working at the login screen.
 */
export default function TempPasswordBanner({ expiresAt }: { expiresAt: string | null }) {
  const { dict, locale } = useLanguage();
  const t = dict.tempPasswordBanner;
  const pathname = usePathname();
  if (pathname === "/change-password") return null;
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
      <span className="text-base" aria-hidden>⚠️</span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{t.title}</div>
        <div className="text-xs opacity-90">{expiresAt ? t.bodyWithDeadline(formatDate(expiresAt, locale)) : t.body}</div>
      </div>
      <Link href="/change-password" className="whitespace-nowrap rounded-lg bg-warn px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
        {t.button}
      </Link>
    </div>
  );
}
