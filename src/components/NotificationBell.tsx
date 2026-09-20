"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import { BellIcon, useNotifications } from "./NotificationProvider";

function Badge({ n, className = "" }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ${className}`}
      aria-label={String(n)}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * Link to /notifications with the unread count. `nav` is the sidebar row
 * (matches the other menu items); `icon` is the compact button in the
 * phone/tablet top bar so the badge is visible without opening the drawer.
 */
export default function NotificationBell({ variant, onNavigate }: { variant: "nav" | "icon"; onNavigate?: () => void }) {
  const { dict } = useLanguage();
  const { unread } = useNotifications();
  const pathname = usePathname();
  const active = pathname === "/notifications";

  if (variant === "icon") {
    return (
      <Link
        href="/notifications"
        aria-label={dict.notifications.bell}
        className="relative flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-subtle"
      >
        <BellIcon className="h-[18px] w-[18px]" />
        <Badge n={unread} className="absolute -right-1.5 -top-1.5" />
      </Link>
    );
  }

  return (
    <Link
      href="/notifications"
      onClick={onNavigate}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium ${
        active ? "bg-brand-soft text-brand-ink" : "text-subtle hover:bg-line-soft"
      }`}
    >
      <BellIcon className={`h-4 w-4 ${active ? "text-brand" : "text-faint"}`} />
      <span className="flex-1">{dict.notifications.bell}</span>
      <Badge n={unread} />
    </Link>
  );
}
