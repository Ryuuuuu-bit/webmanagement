"use client";

import { useLanguage } from "./LanguageProvider";

export default function LanguageToggle() {
  const { locale, toggle } = useLanguage();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={locale === "th" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย"}
      className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm font-medium text-subtle hover:bg-line-soft"
    >
      <span>{locale === "th" ? "ภาษาไทย" : "English"}</span>
      <span className="flex items-center gap-1 text-xs font-semibold">
        <span className={locale === "th" ? "text-brand-ink" : "text-faint"}>TH</span>
        <span className="text-faint">/</span>
        <span className={locale === "en" ? "text-brand-ink" : "text-faint"}>EN</span>
      </span>
    </button>
  );
}
