import type { Metadata } from "next";
import { Sarabun } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import "./globals.css";

const sarabun = Sarabun({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sarabun",
});

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(getLocale());
  return {
    title: dict.appName,
    description: dict.appDescription,
  };
}

// Runs before first paint (a plain inline script, not React) so the right
// theme class is already on <html> by the time anything renders — avoids a
// flash of the light theme for someone who saved/prefers dark.
const NO_FLASH_THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Read once, server-side, from the same cookie the client toggle writes —
  // so the very first server-rendered HTML is already in the right
  // language, and the client LanguageProvider starts in agreement with it
  // (no hydration mismatch, no language flash).
  const locale = getLocale();

  return (
    <html lang={locale} className={sarabun.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body className="font-sans">
        <ThemeProvider>
          <LanguageProvider initialLocale={locale}>{children}</LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
