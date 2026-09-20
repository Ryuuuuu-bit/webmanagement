"use client";

import { useState, useTransition } from "react";
import type { CheckinPolicy } from "@/lib/settings";
import { useLanguage } from "./LanguageProvider";

/**
 * Master Data → check-in security policy. Three switches and a retention
 * number, saved together. Defaults are the strict settings (all on).
 */
export default function CheckinPolicyManagement({
  policy,
  updateCheckinPolicy,
}: {
  policy: CheckinPolicy;
  updateCheckinPolicy: (p: CheckinPolicy) => Promise<{ ok: boolean; message: string }>;
}) {
  const { dict } = useLanguage();
  const t = dict.masterData.policy;
  const [draft, setDraft] = useState<CheckinPolicy>(policy);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function onSave() {
    startTransition(async () => {
      setResult(await updateCheckinPolicy(draft));
    });
  }

  type BoolField = "requireBiometricCheckin" | "requireSelfieCheckin" | "deviceApprovalRequired";
  const Toggle = ({ field, label, hint }: { field: BoolField; label: string; hint: string }) => (
    <label className="flex cursor-pointer items-start justify-between gap-4 border-t border-line-soft py-3 first:border-t-0 first:pt-0">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <span className="relative mt-0.5 inline-flex flex-none">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={draft[field]}
          onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.checked }))}
        />
        <span className="h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-brand" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{t.title}</h2>
      <p className="mt-1 text-sm text-muted">{t.hint}</p>
      <div className="mt-4 flex flex-col">
        <Toggle field="requireBiometricCheckin" label={t.biometricLabel} hint={t.biometricHint} />
        <Toggle field="deviceApprovalRequired" label={t.approvalLabel} hint={t.approvalHint} />
        <Toggle field="requireSelfieCheckin" label={t.selfieLabel} hint={t.selfieHint} />
        <div className="flex items-center justify-between gap-4 border-t border-line-soft py-3">
          <span>
            <span className="block text-sm font-medium">{t.retentionLabel}</span>
            <span className="block text-xs text-muted">{t.retentionHint}</span>
          </span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={7}
              max={365}
              value={draft.selfieRetentionDays}
              onChange={(e) => setDraft((d) => ({ ...d, selfieRetentionDays: Number(e.target.value) }))}
              className="input w-20"
            />
            <span className="text-xs text-faint">{t.days}</span>
          </span>
        </div>
        <div className="flex flex-col gap-2 border-t border-line-soft py-3">
          <span>
            <span className="block text-sm font-medium">{t.hoursLabel}</span>
            <span className="block text-xs text-muted">{t.hoursHint}</span>
          </span>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              {t.workStart}
              <input type="time" value={draft.workStart} onChange={(e) => setDraft((d) => ({ ...d, workStart: e.target.value }))} className="input w-28" />
            </label>
            <label className="flex items-center gap-1.5">
              {t.workEnd}
              <input type="time" value={draft.workEnd} onChange={(e) => setDraft((d) => ({ ...d, workEnd: e.target.value }))} className="input w-28" />
            </label>
            <label className="flex items-center gap-1.5">
              {t.grace}
              <input type="number" min={0} max={180} value={draft.lateGraceMinutes} onChange={(e) => setDraft((d) => ({ ...d, lateGraceMinutes: Number(e.target.value) }))} className="input w-20" />
              <span className="text-faint">{t.minutes}</span>
            </label>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className={`text-xs ${result ? (result.ok ? "text-ok" : "text-danger") : "text-faint"}`}>{result?.message ?? t.warning}</p>
        <button onClick={onSave} disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? dict.common.saving : dict.common.save}
        </button>
      </div>
    </div>
  );
}
