import type { Metadata, Viewport } from "next";
import { Sarabun } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import PwaRegister from "@/components/PwaRegister";
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
    // Installed on iOS (Add to Home Screen), this hides Safari's browser
    // chrome so the app opens full-screen like a native app — paired with
    // manifest.ts's display: "standalone" for Android/Chrome.
    appleWebApp: {
      capable: true,
      title: dict.appName,
      statusBarStyle: "default",
    },
  };
}

// Matches manifest.ts's theme_color — the brand color shown in the phone's
// status bar / task switcher once this is installed as a home-screen app.
export const viewport: Viewport = {
  themeColor: "#2f6f5e",
};

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
        <PwaRegister />
        <ThemeProvider>
          <LanguageProvider initialLocale={locale}>{children}</LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
