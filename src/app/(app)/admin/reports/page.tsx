import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { buildMonthlyReport, MONTH_RE } from "@/lib/report";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { bangkokDateKey } from "@/lib/date";

/** Admin → monthly attendance report: filters, on-screen summary, Excel download. */
export default async function ReportsPage({ searchParams }: { searchParams: { month?: string; site?: string; dept?: string } }) {
  const session = await requireUser();
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  const dict = getDictionary(getLocale());
  const t = dict.reports;
  const h = t.columns;
  const month = searchParams.month && MONTH_RE.test(searchParams.month) ? searchParams.month : bangkokDateKey().slice(0, 7);
  const site = searchParams.site || "";
  const dept = searchParams.dept || "";

  const [sites, depts, report] = await Promise.all([
    prisma.campusLocation.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    buildMonthlyReport({ month, siteId: site || null, departmentId: dept || null }),
  ]);
  const qs = new URLSearchParams({ month, ...(site ? { site } : {}), ...(dept ? { dept } : {}) }).toString();
  const total = report.summary.reduce(
    (a, r) => ({ present: a.present + r.present, late: a.late + r.late, absent: a.absent + r.absent + r.noRecord, leave: a.leave + r.leaveDays }),
    { present: 0, late: 0, absent: 0, leave: 0 }
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h1 className="text-lg font-bold">{t.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.hint}</p>
        <form className="mt-4 flex flex-wrap items-end gap-3 text-sm" method="get">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t.month}
            <input type="month" name="month" defaultValue={month} className="input" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {h.site}
            <select name="site" defaultValue={site} className="input">
              <option value="">{t.all}</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {h.department}
            <select name="dept" defaultValue={dept} className="input">
              <option value="">{t.all}</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <button type="submit" className="rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-soft">{t.show}</button>
          <a href={`/api/reports/attendance?${qs}`} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">{t.download}</a>
        </form>
        <p className="mt-3 text-xs text-faint">{t.countedUntil(report.countedUntil)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t.kpiPresent, total.present, "text-ok"],
          [t.kpiLate, total.late, "text-warn"],
          [t.kpiAbsent, total.absent, "text-danger"],
          [t.kpiLeave, total.leave, "text-info"],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-2xl border border-line bg-surface p-4">
            <div className={`text-2xl font-bold ${tone}`}>{value}</div>
            <div className="text-xs text-muted">{label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{t.summaryTitle(report.summary.length)}</h2>
        {report.summary.length === 0 ? (
          <p className="mt-3 text-sm text-faint">{t.empty}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="table-stack w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-faint">
                  <th className="pb-2 font-semibold">{h.name}</th>
                  <th className="pb-2 font-semibold">{h.workdays}</th>
                  <th className="pb-2 font-semibold">{h.present}</th>
                  <th className="pb-2 font-semibold">{h.late}</th>
                  <th className="pb-2 font-semibold">{h.absent}</th>
                  <th className="pb-2 font-semibold">{h.noRecord}</th>
                  <th className="pb-2 font-semibold">{h.leaveDays}</th>
                  <th className="pb-2 font-semibold">{h.rate}</th>
                </tr>
              </thead>
              <tbody>
                {report.summary.map((r) => (
                  <tr key={r.userId} className="border-t border-line-soft">
                    <td className="py-2">
                      <span className="font-medium">{r.name}</span>
                      <span className="block text-[11px] text-faint">{[r.department, r.site].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="py-2">{r.workdays}</td>
                    <td className="py-2">{r.present}</td>
                    <td className="py-2">{r.late}{r.lateMinutes > 0 && <span className="ml-1 text-[11px] text-faint">({t.minutes(r.lateMinutes)})</span>}</td>
                    <td className="py-2">{r.absent}</td>
                    <td className="py-2">{r.noRecord}</td>
                    <td className="py-2">{r.leaveDays}</td>
                    <td className="py-2">{r.rate === null ? "—" : `${r.rate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
