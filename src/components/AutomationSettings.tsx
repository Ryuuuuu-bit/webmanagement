"use client";

import { useState, useTransition } from "react";
import type { AutomationSettings } from "@/lib/automation";
import { useLanguage } from "./LanguageProvider";

/**
 * (Row/Num/Switch are called as plain functions, not <Components>, so the
 * number inputs keep focus while typing.)
 *
 * Master Data → automatic reminders (sent by the background scheduler) and
 * PDPA retention windows. Saved together.
 */
export default function AutomationSettingsCard({
  settings,
  updateAutomationSettings,
}: {
  settings: AutomationSettings;
  updateAutomationSettings: (s: AutomationSettings) => Promise<{ ok: boolean; message: string }>;
}) {
  const { dict } = useLanguage();
  const t = dict.masterData.automation;
  const [draft, setDraft] = useState<AutomationSettings>(settings);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const set = <K extends keyof AutomationSettings>(k: K, v: AutomationSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const Switch = ({ field }: { field: "remindCheckin" | "remindCheckout" | "pendingDigest" | "lessonPlanReminders" }) => (
    <span className="relative mt-0.5 inline-flex flex-none">
      <input type="checkbox" className="peer sr-only" checked={draft[field]} onChange={(e) => set(field, e.target.checked)} aria-label={t[field]} />
      <span className="h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-brand" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
    </span>
  );
  const Num = ({ field, min, max, unit }: { field: "remindCheckinAfterMin" | "remindCheckoutAfterMin" | "pendingDigestDays" | "attendanceRetentionMonths" | "attachmentRetentionMonths"; min: number; max: number; unit: string }) => (
    <span className="flex items-center gap-1.5 text-xs">
      <input type="number" min={min} max={max} value={draft[field]} onChange={(e) => set(field, Number(e.target.value))} className="input w-20" />
      <span className="text-faint">{unit}</span>
    </span>
  );
  const Row = ({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) => (
    <div className="flex flex-col gap-2 border-t border-line-soft py-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <span className="flex flex-wrap items-center gap-3">{children}</span>
    </div>
  );

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{t.title}</h2>
      <p className="mt-1 text-sm text-muted">{t.hint}</p>

      <div className="mt-4 flex flex-col">
        {Row({ title: t.remindCheckin, hint: t.remindCheckinHint, children: (<>
          {Num({ field: "remindCheckinAfterMin", min: 0, max: 240, unit: t.minutesAfterGrace })}
          {Switch({ field: "remindCheckin" })}
        </>) })}
        {Row({ title: t.remindCheckout, hint: t.remindCheckoutHint, children: (<>
          {Num({ field: "remindCheckoutAfterMin", min: 0, max: 240, unit: t.minutesAfterEnd })}
          {Switch({ field: "remindCheckout" })}
        </>) })}
        {Row({ title: t.workdays, hint: t.workdaysHint, children: (<>
          <span className="flex flex-wrap gap-1">
            {dict.day.short.map((label, i) => {
              const on = draft.remindWeekdays.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set("remindWeekdays", on ? draft.remindWeekdays.filter((x) => x !== i) : [...draft.remindWeekdays, i].sort())}
                  className={`h-8 min-w-9 rounded-lg border px-2 text-xs font-semibold ${on ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-faint"}`}
                >
                  {label}
                </button>
              );
            })}
          </span>
        </>) })}
        {Row({ title: t.pendingDigest, hint: t.pendingDigestHint, children: (<>
          {Num({ field: "pendingDigestDays", min: 1, max: 30, unit: t.days })}
          <label className="flex items-center gap-1.5 text-xs text-faint">
            {t.at}
            <input type="time" value={draft.pendingDigestTime} onChange={(e) => set("pendingDigestTime", e.target.value)} className="input w-28" />
          </label>
          {Switch({ field: "pendingDigest" })}
        </>) })}
        {Row({ title: t.lessonPlanReminders, hint: t.lessonPlanRemindersHint, children: (<>
          {Switch({ field: "lessonPlanReminders" })}
        </>) })}

        <h3 className="mt-3 border-t border-line pt-3 text-sm font-bold">{t.absentTitle}</h3>
        <p className="mb-2 text-xs text-muted">{t.absentHint}</p>
        {Row({ title: t.autoAbsent, hint: t.autoAbsentHint, children: (<>
          <label className="flex items-center gap-1.5 text-xs text-faint">
            {t.absentFrom}
            <input type="date" value={draft.absentFromDate} onChange={(e) => set("absentFromDate", e.target.value)} className="input" />
          </label>
          <span className="relative mt-0.5 inline-flex flex-none">
            <input type="checkbox" className="peer sr-only" checked={draft.autoAbsent} onChange={(e) => set("autoAbsent", e.target.checked)} aria-label={t.autoAbsent} />
            <span className="h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-brand" />
            <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
          </span>
        </>) })}
        {Row({ title: t.absentAfter, hint: t.absentAfterHint, children: (<>
          <span className="flex items-center gap-1.5 text-xs">
            <input type="number" min={0} max={600} value={draft.absentAfterMinutes} onChange={(e) => set("absentAfterMinutes", Number(e.target.value))} className="input w-20" />
            <span className="text-faint">{t.minutesAfterStart}</span>
          </span>
        </>) })}
        {Row({ title: t.dailySummary, hint: t.dailySummaryHint, children: (<>
          <span className="relative mt-0.5 inline-flex flex-none">
            <input type="checkbox" className="peer sr-only" checked={draft.dailySummary} onChange={(e) => set("dailySummary", e.target.checked)} aria-label={t.dailySummary} />
            <span className="h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-brand" />
            <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
          </span>
        </>) })}
        {Row({ title: t.absentOnlyTeachingDays, hint: t.absentOnlyTeachingDaysHint, children: (<>
          <span className="relative mt-0.5 inline-flex flex-none">
            <input type="checkbox" className="peer sr-only" checked={draft.absentOnlyTeachingDays} onChange={(e) => set("absentOnlyTeachingDays", e.target.checked)} aria-label={t.absentOnlyTeachingDays} />
            <span className="h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-brand" />
            <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
          </span>
        </>) })}

        <h3 className="mt-3 border-t border-line pt-3 text-sm font-bold">{t.retentionTitle}</h3>
        <p className="mb-2 text-xs text-muted">{t.retentionHint}</p>
        {Row({ title: t.attendanceRetention, hint: t.attendanceRetentionHint, children: (<>
          {Num({ field: "attendanceRetentionMonths", min: 0, max: 120, unit: t.months })}
        </>) })}
        {Row({ title: t.attachmentRetention, hint: t.attachmentRetentionHint, children: (<>
          {Num({ field: "attachmentRetentionMonths", min: 0, max: 120, unit: t.months })}
        </>) })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className={`text-xs ${result ? (result.ok ? "text-ok" : "text-danger") : "text-faint"}`}>{result?.message ?? t.footer}</p>
        <button onClick={() => startTransition(async () => setResult(await updateAutomationSettings(draft)))} disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? dict.common.saving : dict.common.save}
        </button>
      </div>
    </div>
  );
}
