"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import ThemeToggle from "./ThemeToggle";
import LanguageToggle from "./LanguageToggle";
import { useLanguage } from "./LanguageProvider";

const ICON: Record<string, string> = {
  dashboard:
    '<rect x="1.5" y="1.5" width="6" height="6" rx="1.4"/><rect x="8.5" y="1.5" width="6" height="6" rx="1.4"/><rect x="1.5" y="8.5" width="6" height="6" rx="1.4"/><rect x="8.5" y="8.5" width="6" height="6" rx="1.4"/>',
  schedule:
    '<rect x="1.5" y="2.5" width="13" height="12" rx="1.6"/><line x1="1.5" y1="6" x2="14.5" y2="6"/><line x1="4.5" y1="1" x2="4.5" y2="3.5" stroke-linecap="round"/><line x1="11.5" y1="1" x2="11.5" y2="3.5" stroke-linecap="round"/>',
  checkin:
    '<path d="M8 14.5s5-4.6 5-8.4A5 5 0 0 0 3 6.1c0 3.8 5 8.4 5 8.4Z"/><circle cx="8" cy="6.2" r="1.8"/>',
  attest:
    '<circle cx="8" cy="8.5" r="6"/><path d="M8 5.3V8.5L10.2 10" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.6 1.6h4.8" stroke-linecap="round"/>',
  leave:
    '<rect x="1.5" y="2.5" width="13" height="12" rx="1.6"/><line x1="1.5" y1="6" x2="14.5" y2="6"/><line x1="5.7" y1="9" x2="10.3" y2="12" stroke-linecap="round"/><line x1="10.3" y1="9" x2="5.7" y2="12" stroke-linecap="round"/>',
  lessonplans:
    '<path d="M4 1.5h6l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"/><path d="M10 1.5V4.5h3" stroke-linejoin="round"/><line x1="4.5" y1="8" x2="11.5" y2="8" stroke-linecap="round"/><line x1="4.5" y1="10.5" x2="11.5" y2="10.5" stroke-linecap="round"/><line x1="4.5" y1="13" x2="9" y2="13" stroke-linecap="round"/>',
  teachers:
    '<circle cx="5.6" cy="5.5" r="2.2"/><circle cx="11" cy="6" r="1.7"/><path d="M1.6 14c.4-2.6 2-4 4-4s3.6 1.4 4 4" stroke-linecap="round"/><path d="M10 10.4c1.7.2 2.9 1.4 3.2 3.6" stroke-linecap="round"/>',
  users:
    '<circle cx="8" cy="5" r="2.6"/><path d="M2.5 14c.6-3.4 2.6-5.2 5.5-5.2s4.9 1.8 5.5 5.2" stroke-linecap="round"/>',
  locations:
    '<path d="M8 14.5s5-4.6 5-8.4A5 5 0 0 0 3 6.1c0 3.8 5 8.4 5 8.4Z"/><circle cx="8" cy="6.2" r="1.8"/>',
  masterdata:
    '<rect x="1.5" y="2" width="5.5" height="5.5" rx="1"/><rect x="9" y="2" width="5.5" height="5.5" rx="1"/><rect x="1.5" y="8.5" width="5.5" height="5.5" rx="1"/><rect x="9" y="8.5" width="5.5" height="5.5" rx="1"/>',
  audit: '<path d="M8 1.5l5.5 2.5v4c0 3.2-2.3 5.6-5.5 6.5C4.8 13.6 2.5 11.2 2.5 8V4L8 1.5z"/><path d="M5.8 8l1.6 1.6L10.5 6.4"/>',
};

type NavItem = [href: string, icon: string, label: string];

/**
 * The actual logo/nav-links/footer content, shared between the always-visible
 * desktop sidebar and the slide-over drawer used on phones/tablets — one
 * source of truth for the menu instead of two copies that could drift apart.
 * `onNavigate` closes the mobile drawer the moment a link is tapped (a no-op
 * on desktop, where there's no drawer to close).
 */
function SidebarContent({
  items,
  isAdmin,
  userName,
  onNavigate,
}: {
  items: NavItem[];
  isAdmin: boolean;
  userName: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { dict } = useLanguage();

  return (
    <>
      <div className="flex items-center gap-2 px-2 pb-5 pt-1.5">
        <div className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
          TS
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold">{dict.appName}</div>
          <div className="text-[11px] text-faint">{dict.appTagline}</div>
        </div>
      </div>

      <div className="px-2 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-faint">{dict.sidebar.menu}</div>
      <nav className="flex flex-col gap-0.5">
        {items.map(([href, icon, label]) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium ${
                active ? "bg-brand-soft text-brand-ink" : "text-subtle hover:bg-line-soft"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
                className={active ? "text-brand" : "text-faint"}
                dangerouslySetInnerHTML={{ __html: ICON[icon] }} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1.5">
        <ThemeToggle />
        <LanguageToggle />
        <div className="flex items-center gap-2 rounded-lg bg-line-soft px-3 py-2">
          <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
            {userName.trim().charAt(0).toUpperCase() || "?"}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold text-ink" title={userName}>{userName}</div>
            <div className="text-[11px] text-faint">{isAdmin ? dict.sidebar.roleAdmin : dict.sidebar.roleMember}</div>
          </div>
        </div>
        <Link
          href="/change-password"
          onClick={onNavigate}
          className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-subtle hover:bg-line-soft"
        >
          {dict.sidebar.changePassword}
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-lg border border-line px-3 py-2 text-left text-sm font-medium text-subtle hover:bg-line-soft"
        >
          {dict.sidebar.signOut}
        </button>
      </div>
    </>
  );
}

export default function Sidebar({ isAdmin, userName }: { isAdmin: boolean; userName: string }) {
  const { dict } = useLanguage();
  const [open, setOpen] = useState(false);
  const nav = dict.sidebar.nav;

  const items: NavItem[] = isAdmin
    ? [
        ["/dashboard", "dashboard", nav.dashboard],
        ["/schedule", "schedule", nav.scheduleAll],
        ["/checkin", "checkin", nav.checkinAll],
        ["/attest", "attest", nav.attestApprove],
        ["/leave", "leave", nav.leaveApprove],
        ["/teachers", "teachers", nav.teachers],
        ["/lesson-plans", "lessonplans", nav.lessonPlansAll],
        ["/admin/master-data", "masterdata", nav.masterData],
        ["/admin/users", "users", nav.users],
        ["/admin/locations", "locations", nav.locations],
        ["/admin/audit", "audit", nav.audit],
      ]
    : [
        ["/dashboard", "dashboard", nav.dashboard],
        ["/schedule", "schedule", nav.scheduleMine],
        ["/checkin", "checkin", nav.checkinMine],
        ["/attest", "attest", nav.attestMine],
        ["/leave", "leave", nav.leaveMine],
        ["/lesson-plans", "lessonplans", nav.lessonPlansMine],
      ];

  return (
    <>
      {/* Phone/tablet top bar — replaces the always-visible desktop sidebar
          below the lg breakpoint, since there's no room to keep it pinned
          open on a narrow screen. */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
            TS
          </div>
          <div className="text-sm font-bold leading-tight">{dict.appName}</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={dict.sidebar.menu}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line text-subtle"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <line x1="2" y1="4.5" x2="16" y2="4.5" />
            <line x1="2" y1="9" x2="16" y2="9" />
            <line x1="2" y1="13.5" x2="16" y2="13.5" />
          </svg>
        </button>
      </header>

      {/* Phone/tablet slide-over drawer with the same nav content. */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto bg-surface p-3 shadow-xl">
            <div className="flex items-center justify-end pb-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={dict.common.close}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-faint hover:bg-line-soft hover:text-subtle"
              >
                ✕
              </button>
            </div>
            <SidebarContent items={items} isAdmin={isAdmin} userName={userName} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar — unchanged from before, just hidden below lg now. */}
      <aside className="sticky top-0 hidden h-screen w-56 flex-none flex-col border-r border-line bg-surface p-3 lg:flex">
        <SidebarContent items={items} isAdmin={isAdmin} userName={userName} />
      </aside>
    </>
  );
}
