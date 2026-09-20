"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "./LanguageProvider";
import { BellIcon, useNotifications, type NotificationItem } from "./NotificationProvider";
import { markAllNotificationsRead } from "@/actions/notifications";

const KIND_TONE: Record<string, string> = {
  LEAVE_REQUESTED: "bg-info-soft text-info",
  ATTEST_REQUESTED: "bg-info-soft text-info",
  LESSON_PLAN_SUBMITTED: "bg-info-soft text-info",
  DEVICE_PENDING: "bg-warn-soft text-warn",
  SHARED_DEVICE_DETECTED: "bg-danger-soft text-danger",
  LEAVE_DECIDED: "bg-ok-soft text-ok",
  ATTEST_DECIDED: "bg-ok-soft text-ok",
  LESSON_PLAN_REVIEWED: "bg-ok-soft text-ok",
  DEVICE_DECIDED: "bg-ok-soft text-ok",
};

function timeAgo(iso: string, t: { justNow: string; minutesAgo: (n: number) => string; hoursAgo: (n: number) => string; daysAgo: (n: number) => string }) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t.justNow;
  if (min < 60) return t.minutesAgo(min);
  const h = Math.floor(min / 60);
  if (h < 24) return t.hoursAgo(h);
  return t.daysAgo(Math.floor(h / 24));
}

export default function NotificationList({ initialItems }: { initialItems: NotificationItem[] }) {
  const { dict, locale } = useLanguage();
  const t = dict.notifications;
  const { setUnread, refresh } = useNotifications();
  // Remember which rows were unread when the page opened — they stay
  // highlighted even though we mark them read straight away.
  const [items] = useState(initialItems);
  const unreadAtOpen = useState(() => new Set(initialItems.filter((i) => !i.read).map((i) => i.id)))[0];

  useEffect(() => {
    if (unreadAtOpen.size === 0) return;
    setUnread(0);
    markAllNotificationsRead()
      .then(() => refresh())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold">{t.title}</h1>
        {unreadAtOpen.size > 0 && <span className="text-xs text-muted">{t.unread(unreadAtOpen.size)}</span>}
      </div>

      <div className="rounded-2xl border border-line bg-surface shadow-sm">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-line-soft text-faint">
              <BellIcon className="h-5 w-5" />
            </div>
            {t.empty}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const isNew = unreadAtOpen.has(n.id);
              const tone = KIND_TONE[n.kind] ?? "bg-line-soft text-muted";
              const inner = (
                <div className="flex items-start gap-3 px-4 py-3">
                  <div className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full ${tone}`}>
                    <BellIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className={`text-sm ${isNew ? "font-semibold text-ink" : "font-medium text-subtle"}`}>{n.title}</div>
                      <div className="flex flex-none items-center gap-1.5 text-[11px] text-faint">
                        <time dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString(locale === "en" ? "en-US" : "th-TH")}>
                          {timeAgo(n.createdAt, t)}
                        </time>
                        {isNew && <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />}
                      </div>
                    </div>
                    {n.body && <div className="mt-0.5 text-xs text-muted">{n.body}</div>}
                  </div>
                </div>
              );
              return (
                <li key={n.id} style={isNew ? { background: "color-mix(in srgb, var(--color-brand) 6%, transparent)" } : undefined}>
                  {n.href ? (
                    <Link href={n.href} className="block hover:bg-line-soft">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
