"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import CalendarImport from "./CalendarImport";
import HolidayPresetPanel from "./HolidayPresetPanel";
import type { BulkEventResult, BulkEventRow } from "@/actions/calendar";

type ActionResult = { ok: boolean; message: string };
type Panel = "import" | "holidays" | null;

/** Calendar page header: title, month/year tabs, school filter and the Admin's bulk tools. */
export default function CalendarToolbar({
  view,
  month,
  year,
  siteFilter,
  sites,
  isAdmin,
  importEvents,
  copyYear,
}: {
  view: "month" | "year";
  month: string;
  year: number;
  siteFilter: string;
  sites: { id: string; name: string }[];
  isAdmin: boolean;
  importEvents: (rows: BulkEventRow[]) => Promise<{ ok: boolean; message: string; results: BulkEventResult[] }>;
  copyYear: (fromYear: number, siteId: string | null) => Promise<ActionResult>;
}) {
  const { dict } = useLanguage();
  const t = dict.schoolCalendar;
  const x = dict.calendarTools;
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [pending, startTransition] = useTransition();
  const [copyResult, setCopyResult] = useState<ActionResult | null>(null);
  const siteQ = siteFilter ? `&site=${siteFilter}` : "";
  const prevYear = year - 1;
  const be = (y: number) => y + 543;

  function onCopy() {
    if (!confirm(x.copyConfirm(prevYear, year, be(prevYear), be(year)))) return;
    startTransition(async () => {
      const res = await copyYear(prevYear, siteFilter || null);
      setCopyResult(res);
      router.refresh();
    });
  }

  const tab = (active: boolean) => `rounded-lg px-3 py-1.5 text-sm font-semibold ${active ? "bg-brand-soft text-brand-ink" : "text-subtle hover:bg-line-soft"}`;
  const tool = (active: boolean) => `rounded-lg border px-3 py-1.5 text-xs font-semibold ${active ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-brand-ink hover:bg-line-soft"}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">{t.title}</h1>
          <p className="mt-1 text-sm text-muted">{isAdmin ? t.hintAdmin : t.hintMember}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex gap-1 rounded-xl border border-line bg-surface p-1">
            <Link href={`/calendar?month=${view === "year" ? `${year}-${month.slice(5)}` : month}${siteQ}`} className={tab(view === "month")}>{t.viewMonth}</Link>
            <Link href={`/calendar?view=year&year=${view === "month" ? month.slice(0, 4) : year}${siteQ}`} className={tab(view === "year")}>{t.viewYear}</Link>
          </nav>
          {isAdmin && (
            <select
              value={siteFilter}
              onChange={(e) => router.push(`/calendar?${view === "year" ? `view=year&year=${year}` : `month=${month}`}${e.target.value ? `&site=${e.target.value}` : ""}`)}
              className="input py-1.5"
              aria-label={t.siteFilter}
            >
              <option value="">{t.allSchoolsFilter}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPanel(panel === "import" ? null : "import")} className={tool(panel === "import")}>{x.importOpen}</button>
          <button type="button" onClick={() => setPanel(panel === "holidays" ? null : "holidays")} className={tool(panel === "holidays")}>{x.holidaysOpen}</button>
          <button type="button" disabled={pending} onClick={onCopy} className={tool(false) + " disabled:opacity-50"}>{pending ? dict.common.saving : x.copyButton(prevYear, year, be(prevYear), be(year))}</button>
          {view === "month" && (
            <Link href={`/calendar?view=year&year=${month.slice(0, 4)}${siteQ}`} className="text-xs font-medium text-brand-ink hover:underline">{x.exportHint}</Link>
          )}
        </div>
      )}
      {copyResult && <p className={`text-sm ${copyResult.ok ? "text-brand-ink" : "text-danger"}`}>{copyResult.message}</p>}

      {isAdmin && panel === "import" && <CalendarImport sites={sites} importEvents={importEvents} onDone={() => router.refresh()} />}
      {isAdmin && panel === "holidays" && (
        <HolidayPresetPanel defaultYear={view === "year" ? year : Number(month.slice(0, 4))} sites={sites} importEvents={importEvents} onDone={() => router.refresh()} />
      )}
    </div>
  );
}
