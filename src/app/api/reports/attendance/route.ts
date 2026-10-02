import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import * as XLSX from "xlsx";
import { authOptions } from "@/lib/auth";
import { buildMonthlyReport, LEAVE_TYPES, MONTH_RE } from "@/lib/report";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatTime } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: monthly attendance report as .xlsx (sheets: summary, daily records, leave). */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });
  if (session.user.role !== "ADMIN") return new NextResponse("Forbidden", { status: 403 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH_RE.test(month)) return new NextResponse("Bad month", { status: 400 });
  const locale = getLocale();
  const dict = getDictionary(locale);
  const h = dict.reports.columns;
  const report = await buildMonthlyReport({ month, siteId: req.nextUrl.searchParams.get("site") || null, departmentId: req.nextUrl.searchParams.get("dept") || null });
  const statusLabel = (s: string) => (dict.status.attendance as Record<string, string>)[s] ?? s;
  const leaveLabel = (t: string) => (dict.leave.types as Record<string, string>)[t] ?? t;

  const summary = report.summary.map((r) => {
    const row: Record<string, string | number> = {
      [h.name]: r.name,
      [h.username]: r.username,
      [h.department]: r.department,
      [h.site]: r.site,
      [h.workdays]: r.workdays,
      [h.present]: r.present,
      [h.onTime]: r.onTime,
      [h.late]: r.late,
      [h.lateMinutes]: r.lateMinutes,
      [h.earlyCheckout]: r.earlyCheckout,
      [h.absent]: r.absent,
      [h.noRecord]: r.noRecord,
      [h.leaveDays]: r.leaveDays,
    };
    for (const t of LEAVE_TYPES) row[`${h.leavePrefix}${leaveLabel(t)}`] = r.leaveByType[t] ?? 0;
    row[h.attested] = r.attested;
    row[h.rate] = r.rate ?? "";
    return row;
  });
  const days = report.days.map((d) => ({
    [h.date]: d.date,
    [h.name]: d.name,
    [h.department]: d.department,
    [h.status]: statusLabel(d.status),
    [h.checkin]: formatTime(d.checkin, locale) ?? "",
    [h.checkout]: formatTime(d.checkout, locale) ?? "",
    [h.checkinSite]: d.checkinSite ?? "",
    [h.checkoutSite]: d.checkoutSite ?? "",
    [h.attested]: [d.attestedCheckin ? h.attestedIn : "", d.attestedCheckout ? h.attestedOut : ""].filter(Boolean).join(", "),
    [h.earlyCheckout]: d.earlyCheckout ? "✓" : "",
  }));
  const leaves = report.leaves.map((l) => ({
    [h.name]: l.name,
    [h.leaveType]: leaveLabel(l.type),
    [h.from]: l.from,
    [h.to]: l.to,
    [h.halfDay]: l.halfDay ?? "",
    [h.daysInMonth]: l.days,
    [h.reason]: l.reason,
  }));

  const wb = XLSX.utils.book_new();
  const add = (rows: Record<string, unknown>[], name: string, fallbackHeader: string[]) => {
    const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([fallbackHeader]);
    const keys = rows.length ? Object.keys(rows[0]) : fallbackHeader;
    ws["!cols"] = keys.map((k) => ({ wch: Math.max(10, Math.min(40, k.length + 4)) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add(summary, dict.reports.sheetSummary, [h.name]);
  add(days, dict.reports.sheetDays, [h.date, h.name, h.status]);
  add(leaves, dict.reports.sheetLeave, [h.name, h.leaveType]);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="attendance-${month}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
