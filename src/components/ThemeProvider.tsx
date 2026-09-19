"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
type ThemeContextValue = { theme: Theme; toggle: () => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Site-wide Light/Dark mode. The actual color values live in CSS variables
 * (globals.css, :root vs .dark) — this provider only owns which one is
 * active, persists the choice, and toggles the `dark` class on <html>.
 *
 * A small inline script in layout.tsx's <head> already applies the right
 * class before first paint (avoiding a light-mode flash for users who
 * prefer/saved dark), so the initial state here is read from that class
 * rather than defaulting to "light".
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  function toggle() {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("theme", next);
      } catch {
        // localStorage can throw (private mode, blocked storage) — theme
        // still applies for this page load, just won't persist.
      }
      return next;
    });
  }

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
