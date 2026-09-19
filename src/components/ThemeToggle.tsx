"use client";

import { useTheme } from "./ThemeProvider";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"}
      className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm font-medium text-subtle hover:bg-line-soft"
    >
      <span>{isDark ? "โหมดมืด" : "โหมดสว่าง"}</span>
      <span aria-hidden="true">{isDark ? "🌙" : "☀️"}</span>
    </button>
  );
}
