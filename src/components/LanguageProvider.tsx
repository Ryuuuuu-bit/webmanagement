"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { getDictionary, type Locale } from "@/lib/i18n/dictionaries";

const LOCALE_COOKIE = "locale";

type LanguageContextValue = {
  locale: Locale;
  dict: ReturnType<typeof getDictionary>;
  toggle: () => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Real TH/EN language switching, site-wide. `initialLocale` comes from the
 * root layout (a Server Component reading the same cookie), so server- and
 * client-rendered text always agree on the very first paint — no flash of
 * the wrong language.
 *
 * Toggling updates this context immediately (client components re-render in
 * the new language right away) AND sets the cookie AND calls
 * router.refresh() so every Server Component page re-renders server-side in
 * the new language too — this is a real, whole-site switch, not just a
 * client-side skin.
 */
export function LanguageProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const router = useRouter();

  function toggle() {
    const next: Locale = locale === "th" ? "en" : "th";
    setLocale(next);
    try {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000`;
    } catch {
      // Cookies can be unavailable in rare cases (privacy mode edge cases) —
      // the client-side language still switches for this session either way.
    }
    router.refresh();
  }

  return (
    <LanguageContext.Provider value={{ locale, dict: getDictionary(locale), toggle }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
