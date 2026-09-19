// Server-only: reads the visitor's chosen language from a cookie. Kept
// separate from dictionaries.ts (which is imported by client components
// too) so "next/headers" never ends up in the client bundle.
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, type Locale } from "./dictionaries";

export const LOCALE_COOKIE = "locale";

export function getLocale(): Locale {
  const value = cookies().get(LOCALE_COOKIE)?.value;
  return value === "en" ? "en" : DEFAULT_LOCALE;
}
