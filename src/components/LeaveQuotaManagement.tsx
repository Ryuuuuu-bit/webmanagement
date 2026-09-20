"use client";

import { useState, useTransition } from "react";
import type { LeaveType } from "@prisma/client";
import { useLanguage } from "./LanguageProvider";

type QuotaRow = { type: LeaveType; daysPerYear: number };
type ActionResult = { ok: boolean; message: string };

/**
 * Lets Admin adjust each leave type's annual day quota (0 = unlimited) —
 * pre-filled with the Thai Labor Protection Act's statutory minimums (see
 * src/lib/leaveQuota.ts) until changed. Every teacher shares the same
 * quota per type; there's no per-person override (client decision).
 */
export default function LeaveQuotaManagement({
  quotas,
  updateLeaveQuota,
}: {
  quotas: QuotaRow[];
  updateLeaveQuota: (type: LeaveType, daysPerYear: number) => Promise<ActionResult>;
}) {
  const { dict } = useLanguage();
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(quotas.map((q) => [q.type, q.daysPerYear]))
  );
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<Record<string, ActionResult>>({});

  function onSave(type: LeaveType) {
    startTransition(async () => {
      const res = await updateLeaveQuota(type, values[type] ?? 0);
      setResults((prev) => ({ ...prev, [type]: res }));
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-base font-bold">{dict.masterData.leaveQuota.title}</h2>
      <p className="mt-1 text-sm text-muted">{dict.masterData.leaveQuota.hint}</p>
      <div className="mt-4 flex flex-col gap-2">
        {quotas.map((q) => (
          <div
            key={q.type}
            className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2 text-sm first:border-t-0 first:pt-0"
          >
            <span className="font-medium">{dict.leave.types[q.type]}</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={values[q.type] ?? 0}
                onChange={(e) => setValues((prev) => ({ ...prev, [q.type]: Number(e.target.value) }))}
                className="input w-24"
              />
              <span className="text-xs text-faint">
                {(values[q.type] ?? 0) === 0 ? dict.leave.quotaUnlimited : dict.masterData.leaveQuota.unit}
              </span>
              <button
                disabled={pending}
                onClick={() => onSave(q.type)}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {dict.common.save}
              </button>
            </div>
            {results[q.type] && (
              <p className={`w-full text-xs ${results[q.type].ok ? "text-brand-ink" : "text-danger"}`}>
                {results[q.type].message}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
