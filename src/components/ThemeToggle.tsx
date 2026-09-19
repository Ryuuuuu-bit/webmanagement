"use client";

import { useTheme } from "./ThemeProvider";
import { useLanguage } from "./LanguageProvider";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { dict } = useLanguage();
  const isDark = theme === "dark";

  // `theme` is read from the DOM's actual class on the client (set by the
  // no-flash script before hydration) but always starts as "light" during
  // server rendering (no `document` on the server), so this button's text
  // can legitimately differ between the server-rendered HTML and the first
  // client render. suppressHydrationWarning tells React that's expected for
  // these specific nodes instead of treating it as a real bug — the visual
  // theme itself is already correct pre-paint via the inline script; only
  // this label/icon briefly reflects the server default until hydration.
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? dict.theme.light : dict.theme.dark}
      suppressHydrationWarning
      className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm font-medium text-subtle hover:bg-line-soft"
    >
      <span suppressHydrationWarning>{isDark ? dict.theme.dark : dict.theme.light}</span>
      <span aria-hidden="true" suppressHydrationWarning>{isDark ? "🌙" : "☀️"}</span>
    </button>
  );
}
