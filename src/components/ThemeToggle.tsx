"use client";

import { useTheme } from "./ThemeProvider";
import { useLanguage } from "./LanguageProvider";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { dict } = useLanguage();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? dict.theme.light : dict.theme.dark}
      className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm font-medium text-subtle hover:bg-line-soft"
    >
      <span>{isDark ? dict.theme.dark : dict.theme.light}</span>
      <span aria-hidden="true">{isDark ? "🌙" : "☀️"}</span>
    </button>
  );
}
