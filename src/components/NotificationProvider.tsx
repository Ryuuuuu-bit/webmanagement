"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import { markNotificationRead } from "@/actions/notifications";

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
};

type Ctx = {
  unread: number;
  items: NotificationItem[];
  refresh: () => Promise<void>;
  /** Optimistically clears the badge (the page/action does the real write). */
  setUnread: (n: number) => void;
};

const NotificationContext = createContext<Ctx>({ unread: 0, items: [], refresh: async () => {}, setUnread: () => {} });

export function useNotifications() {
  return useContext(NotificationContext);
}

const POLL_MS = 30_000;
const TOAST_MS = 8_000;

/**
 * Keeps the bell badge current and pops a small toast when something new
 * arrives while the app is open — the "alert" the client asked for, without
 * push infrastructure. Polls /api/notifications every 30 s while the tab is
 * visible and immediately on returning to it; the first poll only seeds the
 * known set (no toast for things that were already there).
 */
export default function NotificationProvider({ initialUnread, children }: { initialUnread: number; children: React.ReactNode }) {
  const { dict } = useLanguage();
  const pathname = usePathname();
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [toast, setToast] = useState<{ count: number; latest: NotificationItem } | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number; items: NotificationItem[] };
      setUnread(data.unread);
      setItems(data.items);
      if (seen.current === null) {
        seen.current = new Set(data.items.map((i) => i.id));
        return;
      }
      const fresh = data.items.filter((i) => !i.read && !seen.current!.has(i.id));
      data.items.forEach((i) => seen.current!.add(i.id));
      if (fresh.length > 0) {
        setToast({ count: fresh.length, latest: fresh[0] });
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
      }
    } catch {
      // Offline or signed out — try again next tick.
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [refresh]);

  // A server action on the page we're on may have created a notification for
  // *us* (rare) or changed what's unread — refresh after navigation too.
  useEffect(() => {
    // The notifications page marks everything read itself and refreshes
    // afterwards — polling here first would flash the old count.
    if (seen.current !== null && pathname !== "/notifications") refresh();
  }, [pathname, refresh]);

  function openToast() {
    const t = toast;
    setToast(null);
    if (t && !t.latest.read) {
      setUnread((n) => Math.max(0, n - 1));
      markNotificationRead(t.latest.id).catch(() => {});
    }
  }

  return (
    <NotificationContext.Provider value={{ unread, items, refresh, setUnread }}>
      {children}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-sm animate-[fadeIn_.2s_ease-out] rounded-xl border border-line bg-surface p-3 shadow-lg sm:left-auto sm:right-6 sm:bottom-6"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-soft text-brand-ink">
              <BellIcon />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{dict.notifications.newToast(toast.count)}</div>
              <div className="truncate text-sm font-semibold text-ink">{toast.latest.title}</div>
              {toast.latest.body && <div className="line-clamp-2 text-xs text-muted">{toast.latest.body}</div>}
              <div className="mt-2 flex gap-2">
                <Link
                  href={toast.count > 1 ? "/notifications" : toast.latest.href ?? "/notifications"}
                  onClick={openToast}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {dict.notifications.open}
                </Link>
                <button type="button" onClick={() => setToast(null)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-subtle">
                  {dict.common.close}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
}

export function BellIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 1.8a4 4 0 0 0-4 4v2.4c0 .7-.3 1.3-.7 1.8L2.5 11h11l-.8-1a2.8 2.8 0 0 1-.7-1.8V5.8a4 4 0 0 0-4-4Z" />
      <path d="M6.5 13a1.6 1.6 0 0 0 3 0" />
    </svg>
  );
}
