"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

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
};

export default function Sidebar({ isAdmin, userName }: { isAdmin: boolean; userName: string }) {
  const pathname = usePathname();

  const items = isAdmin
    ? [
        ["/dashboard", "dashboard", "Dashboard"],
        ["/schedule", "schedule", "ตารางสอนทั้งหมด"],
        ["/checkin", "checkin", "เช็คอิน-เอาต์ (ภาพรวม)"],
        ["/attest", "attest", "อนุมัติรับรองเวลา"],
        ["/leave", "leave", "อนุมัติการลา"],
        ["/teachers", "teachers", "รายชื่ออาจารย์"],
        ["/lesson-plans", "lessonplans", "แผนการสอน"],
        ["/admin/master-data", "masterdata", "ข้อมูลหลัก"],
        ["/admin/users", "users", "จัดการผู้ใช้"],
        ["/admin/locations", "locations", "จุดเช็คอิน-เอาต์"],
      ]
    : [
        ["/dashboard", "dashboard", "Dashboard"],
        ["/schedule", "schedule", "ตารางสอนของฉัน"],
        ["/checkin", "checkin", "เช็คอิน-เช็คเอาต์"],
        ["/attest", "attest", "ขอรับรองเวลา"],
        ["/leave", "leave", "การลาของฉัน"],
        ["/lesson-plans", "lessonplans", "ส่งแผนการสอน"],
      ];

  return (
    <aside className="sticky top-0 flex h-screen w-56 flex-none flex-col border-r border-black/10 bg-white p-3">
      <div className="flex items-center gap-2 px-2 pb-5 pt-1.5">
        <div className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
          TS
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold">TeachSchedule</div>
          <div className="text-[11px] text-black/45">ระบบตารางสอนอาจารย์</div>
        </div>
      </div>

      <div className="px-2 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-black/40">เมนู</div>
      <nav className="flex flex-col gap-0.5">
        {items.map(([href, icon, label]) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium ${
                active ? "bg-brand-soft text-brand-ink" : "text-black/65 hover:bg-black/5"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
                className={active ? "text-brand" : "text-black/40"}
                dangerouslySetInnerHTML={{ __html: ICON[icon] }} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1.5">
        <div className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2">
          <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand text-xs font-bold text-white">
            {userName.trim().charAt(0).toUpperCase() || "?"}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold text-black/80" title={userName}>{userName}</div>
            <div className="text-[11px] text-black/45">{isAdmin ? "ผู้ดูแลระบบ" : "อาจารย์ผู้สอน"}</div>
          </div>
        </div>
        <Link
          href="/change-password"
          className="rounded-lg border border-black/10 px-3 py-2 text-sm font-medium text-black/60 hover:bg-black/5"
        >
          เปลี่ยนรหัสผ่าน
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-lg border border-black/10 px-3 py-2 text-left text-sm font-medium text-black/60 hover:bg-black/5"
        >
          ออกจากระบบ
        </button>
      </div>
    </aside>
  );
}
