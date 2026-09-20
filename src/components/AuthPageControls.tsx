"use client";

import { useLanguage } from "./LanguageProvider";
import { useTheme } from "./ThemeProvider";

/**
 * Compact TH/EN + light/dark switch pinned to the top-right of the public
 * pages (login, forgot/reset password, device enrollment, forced password
 * change) — the sidebar carries the same controls once signed in, but
 * these pages have no sidebar, and the client wants the language choice
 * available from the very first screen.
 */
export default function AuthPageControls() {
  const { locale, toggle: toggleLanguage, dict } = useLanguage();
  const { theme, toggle: toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="fixed right-3 top-3 z-40 flex items-center gap-1 rounded-full border border-line bg-surface p-1 shadow-sm">
      <div role="group" aria-label="Language" className="flex items-center rounded-full bg-line-soft p-0.5 text-[11px] font-semibold">
        <button
          type="button"
          onClick={() => locale !== "th" && toggleLanguage()}
          aria-pressed={locale === "th"}
          className={`rounded-full px-2.5 py-1 transition-colors ${locale === "th" ? "bg-brand text-white shadow-sm" : "text-muted hover:text-ink"}`}
        >
          TH
        </button>
        <button
          type="button"
          onClick={() => locale !== "en" && toggleLanguage()}
          aria-pressed={locale === "en"}
          className={`rounded-full px-2.5 py-1 transition-colors ${locale === "en" ? "bg-brand text-white shadow-sm" : "text-muted hover:text-ink"}`}
        >
          EN
        </button>
      </div>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={isDark ? dict.theme.light : dict.theme.dark}
        title={isDark ? dict.theme.light : dict.theme.dark}
        suppressHydrationWarning
        className="flex h-7 w-7 items-center justify-center rounded-full text-sm text-subtle hover:bg-line-soft"
      >
        <span aria-hidden="true" suppressHydrationWarning>{isDark ? "🌙" : "☀️"}</span>
      </button>
    </div>
  );
}
