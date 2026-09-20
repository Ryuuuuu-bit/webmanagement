"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { getPushPublicKey, hasPushSubscription, removePushSubscription, savePushSubscription } from "@/actions/push";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(Array.from(raw, (c) => c.charCodeAt(0)));
}

type State = "loading" | "unsupported" | "unconfigured" | "denied" | "off" | "on";

/**
 * "เปิดการแจ้งเตือนบนมือถือ" card: subscribes this browser to Web Push so
 * notifications arrive even when the app is closed. On iPhone this only
 * works once the app is installed to the Home Screen (iOS 16.4+), which
 * the hint explains.
 */
export default function PushToggle() {
  const { dict } = useLanguage();
  const t = dict.push;
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState("unsupported");
        return;
      }
      const key = await getPushPublicKey();
      if (!key) {
        setState("unconfigured");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub && (await hasPushSubscription(sub.endpoint))) setState("on");
      else setState("off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const key = await getPushPublicKey();
      if (!key) {
        setState("unconfigured");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
      const json = sub.toJSON();
      const res = await savePushSubscription({ endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } });
      setState(res.ok ? "on" : "off");
      if (!res.ok) setError(t.failed);
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "unconfigured") return null;

  const isStandalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
  const isIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{t.title}</div>
          <div className="text-xs text-muted">
            {state === "unsupported" ? (isIOS && !isStandalone ? t.iosInstallFirst : t.unsupported) : state === "denied" ? t.denied : state === "on" ? t.onHint : t.offHint}
          </div>
          {error && <div className="mt-1 text-xs text-danger">{error}</div>}
        </div>
        {(state === "on" || state === "off") && (
          <button
            type="button"
            disabled={busy}
            onClick={state === "on" ? disable : enable}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${state === "on" ? "border border-line text-subtle hover:bg-line-soft" : "bg-brand text-white"}`}
          >
            {state === "on" ? t.turnOff : t.turnOn}
          </button>
        )}
      </div>
    </div>
  );
}
