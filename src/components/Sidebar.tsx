"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import ThemeToggle from "./ThemeToggle";
import LanguageToggle from "./LanguageToggle";
import { useLanguage } from "./LanguageProvider";
import NotificationBell from "./NotificationBell";
import { removeThisBrowserPush } from "@/actions/push";

/** Shared phones: stop this browser receiving the outgoing user's pushes, then sign out. Best-effort, never blocks. */
async function signOutClean() {
  try {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removeThisBrowserPush(sub.endpoint);
        await sub.unsubscribe().catch(() => {});
      }
    }
  } catch {}
  signOut({ callbackUrl: "/login" });
}

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
  reports: '<path d="M3 13.5h10"/><path d="M4.5 11V7.5"/><path d="M8 11V4"/><path d="M11.5 11V9"/>',
  audit: '<path d="M8 1.5l5.5 2.5v4c0 3.2-2.3 5.6-5.5 6.5C4.8 13.6 2.5 11.2 2.5 8V4L8 1.5z"/><path d="M5.8 8l1.6 1.6L10.5 6.4"/>',
  calendar:
    '<rect x="1.5" y="2.5" width="13" height="12" rx="1.6"/><line x1="1.5" y1="6" x2="14.5" y2="6"/><line x1="4.5" y1="1" x2="4.5" y2="3.5" stroke-linecap="round"/><line x1="11.5" y1="1" x2="11.5" y2="3.5" stroke-linecap="round"/><circle cx="5" cy="9" r=".7" fill="currentColor" stroke="none"/><circle cx="8" cy="9" r=".7" fill="currentColor" stroke="none"/><circle cx="11" cy="9" r=".7" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r=".7" fill="currentColor" stroke="none"/><circle cx="8" cy="12" r=".7" fill="currentColor" stroke="none"/>',
  documents:
    '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><circle cx="5.6" cy="7" r="1.6"/><path d="M3.4 11.2c.4-1.3 1.2-2 2.2-2s1.8.7 2.2 2" stroke-linecap="round"/><line x1="9.5" y1="6" x2="12" y2="6" stroke-linecap="round"/><line x1="9.5" y1="8.5" x2="12" y2="8.5" stroke-linecap="round"/>',
  substitutes:
    '<circle cx="5" cy="5" r="2.2"/><path d="M1.5 13c.4-2.4 1.7-3.6 3.5-3.6" stroke-linecap="round"/><path d="M9 4.5h4.5M11.5 2.5l2 2-2 2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 10.5H9.5M11.5 8.5l-2 2 2 2" stroke-linecap="round" stroke-linejoin="round"/>',
  more: '<circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none"/>',
  feedback:
    '<path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H6.5L3 14v-3H3.5A1.5 1.5 0 0 1 2 9.5v-6Z" stroke-linejoin="round"/><line x1="8" y1="4.6" x2="8" y2="7.2" stroke-linecap="round"/><circle cx="8" cy="9" r=".5" fill="currentColor" stroke="none"/>',
};

type NavItem = [href: string, icon: string, label: string];
/** A titled block of links — the menu is grouped by what the person is doing (daily work / requests / admin / help). */
type NavGroup = { title: string; items: NavItem[] };

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICON[name] ?? "" }} />
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));
}

function Logo({ compact = false }: { compact?: boolean }) {
  const { dict } = useLanguage();
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5" aria-label={dict.appName}>
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-ink text-sm font-bold text-white shadow-card">
        TS
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-bold tracking-tight">{dict.appName}</div>
          <div className="text-[11px] text-faint">{dict.appTagline}</div>
        </div>
      )}
    </Link>
  );
}

function Avatar({ name, size = "h-9 w-9" }: { name: string; size?: string }) {
  return (
    <div className={`flex ${size} flex-none items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-ink`}>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

/** Theme + language toggles side by side. */
function Preferences() {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <ThemeToggle />
      <LanguageToggle />
    </div>
  );
}

/** Desktop (lg+) sidebar: grouped links, user card, preferences. */
function DesktopSidebar({ groups, isAdmin, userName }: { groups: NavGroup[]; isAdmin: boolean; userName: string }) {
  const pathname = usePathname();
  const { dict } = useLanguage();
  return (
    <aside className="sticky top-0 hidden h-screen w-64 flex-none flex-col border-r border-line bg-surface px-3 pb-3 pt-4 lg:flex">
      <div className="px-2 pb-4">
        <Logo />
      </div>
      <nav className="-mx-1 flex flex-1 flex-col gap-0.5 overflow-y-auto px-1" aria-label={dict.sidebar.menu}>
        <NotificationBell variant="nav" />
        {groups.map((g) => (
          <div key={g.title} className="flex flex-col gap-0.5">
            <div className="px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-faint">{g.title}</div>
            {g.items.map(([href, icon, label]) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors ${
                    active ? "bg-brand-soft text-brand-ink" : "text-subtle hover:bg-line-soft hover:text-ink"
                  }`}
                >
                  {active && <span className="absolute -left-1 top-2 h-5 w-1 rounded-full bg-brand" />}
                  <Icon name={icon} className={`h-4 w-4 flex-none ${active ? "text-brand" : "text-faint group-hover:text-subtle"}`} />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
        <div className="flex items-center gap-2.5 px-1">
          <Avatar name={userName} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-semibold text-ink" title={userName}>{userName}</div>
            <div className="text-[11px] text-faint">{isAdmin ? dict.sidebar.roleAdmin : dict.sidebar.roleMember}</div>
          </div>
        </div>
        <Preferences />
        <div className="grid grid-cols-2 gap-1.5">
          <Link href="/change-password" className="btn-ghost btn-sm border border-line">{dict.sidebar.changePassword}</Link>
          <button onClick={() => signOutClean()} className="btn-ghost btn-sm border border-line">{dict.sidebar.signOut}</button>
        </div>
      </div>
    </aside>
  );
}

/**
 * Phone/tablet: a slim top bar (page title, bell, avatar), a bottom tab bar
 * with the 4 most-used destinations — reachable with the thumb, like a
 * native app — and "เมนู" opening a bottom sheet with every page as tiles.
 */
function MobileNav({ groups, tabs, isAdmin, userName }: { groups: NavGroup[]; tabs: NavItem[]; isAdmin: boolean; userName: string }) {
  const pathname = usePathname();
  const { dict } = useLanguage();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  const inTabs = tabs.some(([href]) => isActive(pathname, href));
  const current = groups.flatMap((g) => g.items).find(([href]) => isActive(pathname, href));
  const moreActive = open || !inTabs;

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur lg:hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo compact />
            <div className="truncate text-[15px] font-bold">{current?.[2] ?? dict.appName}</div>
          </div>
          <div className="flex flex-none items-center gap-2">
            <NotificationBell variant="icon" />
            <button type="button" onClick={() => setOpen(true)} aria-label={dict.sidebar.menu} className="rounded-full">
              <Avatar name={userName} />
            </button>
          </div>
        </div>
      </header>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label={dict.sidebar.menu}>
        <div className="mx-auto grid max-w-md grid-cols-5">
          {tabs.map(([href, icon, label]) => {
            const active = isActive(pathname, href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} className="flex flex-col items-center gap-0.5 pb-2 pt-2">
                <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${active ? "bg-brand-soft text-brand" : "text-faint"}`}>
                  <Icon name={icon} className="h-[19px] w-[19px]" />
                </span>
                <span className={`text-[11px] leading-tight ${active ? "font-semibold text-brand-ink" : "text-muted"}`}>{label}</span>
              </Link>
            );
          })}
          <button type="button" onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 pb-2 pt-2" aria-expanded={open}>
            <span className={`flex h-7 w-12 items-center justify-center rounded-full ${moreActive ? "bg-brand-soft text-brand" : "text-faint"}`}>
              <Icon name="more" className="h-[19px] w-[19px]" />
            </span>
            <span className={`text-[11px] leading-tight ${moreActive ? "font-semibold text-brand-ink" : "text-muted"}`}>{dict.sidebar.tabs.more}</span>
          </button>
        </div>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={dict.sidebar.menu}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="sheet-up safe-bottom absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-3xl bg-page shadow-pop">
            <div className="sticky top-0 z-10 flex justify-center bg-page pb-2 pt-2.5">
              <span className="h-1.5 w-10 rounded-full bg-line-strong" />
            </div>
            <div className="flex flex-col gap-4 px-4 pb-6">
              <div className="card flex items-center gap-3 p-3">
                <Avatar name={userName} size="h-11 w-11" />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate font-semibold">{userName}</div>
                  <div className="text-xs text-faint">{isAdmin ? dict.sidebar.roleAdmin : dict.sidebar.roleMember}</div>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label={dict.common.close} className="flex h-9 w-9 items-center justify-center rounded-full bg-line-soft text-subtle">
                  ✕
                </button>
              </div>
              {groups.map((g) => (
                <section key={g.title}>
                  <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-faint">{g.title}</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {g.items.map(([href, icon, label]) => {
                      const active = isActive(pathname, href);
                      return (
                        <Link
                          key={href}
                          href={href}
                          className={`flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl border p-2 text-center text-xs font-medium leading-tight shadow-card ${
                            active ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-surface text-subtle"
                          }`}
                        >
                          <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${active ? "bg-brand text-white" : "bg-brand-soft text-brand"}`}>
                            <Icon name={icon} className="h-[18px] w-[18px]" />
                          </span>
                          {label}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
              <Preferences />
              <div className="grid grid-cols-2 gap-2">
                <Link href="/change-password" className="btn-secondary">{dict.sidebar.changePassword}</Link>
                <button onClick={() => signOutClean()} className="btn-secondary !text-danger">{dict.sidebar.signOut}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function Sidebar({ isAdmin, userName }: { isAdmin: boolean; userName: string }) {
  const { dict } = useLanguage();
  const nav = dict.sidebar.nav;
  const gt = dict.sidebar.groups;
  const tab = dict.sidebar.tabs;

  const groups: NavGroup[] = isAdmin
    ? [
        {
          title: gt.daily,
          items: [
            ["/dashboard", "dashboard", nav.dashboard],
            ["/schedule", "schedule", nav.scheduleAll],
            ["/checkin", "checkin", nav.checkinAll],
            ["/teachers", "teachers", nav.teachers],
            ["/substitutes", "substitutes", nav.substitutes],
            ["/calendar", "calendar", nav.calendar],
            ["/admin/reports", "reports", nav.reports],
          ],
        },
        {
          title: gt.approvals,
          items: [
            ["/leave", "leave", nav.leaveApprove],
            ["/attest", "attest", nav.attestApprove],
            ["/lesson-plans", "lessonplans", nav.lessonPlansAll],
          ],
        },
        {
          title: gt.manage,
          items: [
            ["/admin/users", "users", nav.users],
            ["/documents", "documents", nav.documents],
            ["/admin/locations", "locations", nav.locations],
            ["/admin/master-data", "masterdata", nav.masterData],
            ["/admin/audit", "audit", nav.audit],
          ],
        },
        { title: gt.help, items: [["/feedback", "feedback", nav.feedback]] },
      ]
    : [
        {
          title: gt.daily,
          items: [
            ["/dashboard", "dashboard", nav.dashboard],
            ["/checkin", "checkin", nav.checkinMine],
            ["/schedule", "schedule", nav.scheduleMine],
            ["/calendar", "calendar", nav.calendar],
          ],
        },
        {
          title: gt.requests,
          items: [
            ["/leave", "leave", nav.leaveMine],
            ["/attest", "attest", nav.attestMine],
            ["/lesson-plans", "lessonplans", nav.lessonPlansMine],
            ["/documents", "documents", nav.documentsMine],
          ],
        },
        { title: gt.help, items: [["/feedback", "feedback", nav.feedback]] },
      ];

  // Bottom-bar destinations on phones (everything else is under "เมนู").
  const tabs: NavItem[] = isAdmin
    ? [["/dashboard", "dashboard", tab.home], ["/checkin", "checkin", tab.checkin], ["/substitutes", "substitutes", tab.substitutes], ["/calendar", "calendar", tab.calendar]]
    : [["/dashboard", "dashboard", tab.home], ["/checkin", "checkin", tab.checkin], ["/schedule", "schedule", tab.schedule], ["/calendar", "calendar", tab.calendar]];

  return (
    <>
      <MobileNav groups={groups} tabs={tabs} isAdmin={isAdmin} userName={userName} />
      <DesktopSidebar groups={groups} isAdmin={isAdmin} userName={userName} />
    </>
  );
}
