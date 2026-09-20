"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "./LanguageProvider";

const DISMISS_KEY = "ts.installPromptDismissedAt";
const DISMISS_DAYS = 14;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return true;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function detectPlatform(): "ios" | "android" | "other" {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

/**
 * "Add this app to your home screen" guide. The check-in flow is already a
 * one-tap experience *once the site is installed as a home-screen app*
 * (see manifest.ts) — most people just never find that option. So on
 * phones that are still browsing in a normal browser tab we show the
 * platform's exact steps (iOS: Share → Add to Home Screen; Android: the
 * native install prompt, or ⋮ → Add to Home screen), dismissible for two
 * weeks. Hidden entirely once running as an installed app.
 */
export default function InstallPrompt({ forceShow = false }: { forceShow?: boolean }) {
  const { dict } = useLanguage();
  const t = dict.install;
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const p = detectPlatform();
    setPlatform(p);
    if (p === "other" && !forceShow) return;
    if (!forceShow) {
      try {
        const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
        if (at && Date.now() - at < DISMISS_DAYS * 86400000) return;
      } catch {
        // ignore
      }
    }
    setVisible(true);

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [forceShow]);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setVisible(false);
  }

  async function nativeInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  }

  if (!visible) return null;

  return (
    <div className="rounded-2xl border border-brand bg-brand-soft p-4 text-sm text-brand-ink shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-brand text-xs font-bold text-white">TS</div>
          <div>
            <p className="font-semibold">{t.title}</p>
            <p className="mt-0.5 text-xs opacity-80">{t.subtitle}</p>
          </div>
        </div>
        {!forceShow && (
          <button onClick={dismiss} className="text-xs opacity-60 hover:opacity-100" aria-label={dict.common.close}>
            ✕
          </button>
        )}
      </div>

      {installed ? (
        <p className="mt-3 text-xs font-medium">{t.installed}</p>
      ) : installEvent ? (
        <button onClick={nativeInstall} className="mt-3 w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
          {t.installButton}
        </button>
      ) : (
        <ol className="mt-3 flex flex-col gap-1.5 text-xs">
          {(platform === "ios" ? t.stepsIos : platform === "android" ? t.stepsAndroid : t.stepsOther).map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
      {platform === "ios" && !installed && <p className="mt-2 text-[11px] opacity-70">{t.iosSafariNote}</p>}
    </div>
  );
}
