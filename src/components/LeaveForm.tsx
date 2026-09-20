"use client";

import { useRef, useState, useTransition } from "react";
import type { LeaveType } from "@prisma/client";
import { useLanguage } from "./LanguageProvider";

type QuotaStatus = { type: LeaveType; quota: number; used: number; remaining: number | null };
type ActionResult = { ok: boolean; message: string };

/**
 * The leave-request form plus a summary of this teacher's quota usage for
 * the current calendar year — a client component (not a plain server-action
 * form) so it can show the quota table live and surface the over-quota
 * warning `requestLeave` returns without blocking the submission itself
 * (client decision: warn, don't block — see src/lib/leaveQuota.ts).
 */
export default function LeaveForm({
  requestLeave,
  quotaStatus,
}: {
  requestLeave: (formData: FormData) => Promise<ActionResult>;
  quotaStatus: QuotaStatus[];
}) {
  const { dict } = useLanguage();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const res = await requestLeave(formData);
      setResult(res);
      if (res.ok) form.reset();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-bold">{dict.leave.quotaTitle}</h3>
        <p className="mt-0.5 text-xs text-muted">{dict.leave.quotaHint}</p>
        <div className="mt-2 overflow-x-auto rounded-lg border border-line-soft">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left uppercase text-faint">
                <th className="px-3 py-2">{dict.leave.quotaColType}</th>
                <th className="px-3 py-2">{dict.leave.quotaColUsed}</th>
                <th className="px-3 py-2">{dict.leave.quotaColQuota}</th>
                <th className="px-3 py-2">{dict.leave.quotaColRemaining}</th>
              </tr>
            </thead>
            <tbody>
              {quotaStatus.map((q) => (
                <tr key={q.type} className="border-t border-line-soft">
                  <td className="px-3 py-1.5">{dict.leave.types[q.type]}</td>
                  <td className="px-3 py-1.5">{q.used}</td>
                  <td className="px-3 py-1.5">{q.quota === 0 ? dict.leave.quotaUnlimited : q.quota}</td>
                  <td className={`px-3 py-1.5 ${q.remaining !== null && q.remaining <= 0 ? "font-semibold text-danger" : ""}`}>
                    {q.remaining === null ? dict.leave.quotaUnlimited : q.remaining}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <Field label={dict.leave.fieldType}>
            <select name="type" className="input">
              <option value="SICK">{dict.leave.types.SICK}</option>
              <option value="PERSONAL">{dict.leave.types.PERSONAL}</option>
              <option value="VACATION">{dict.leave.types.VACATION}</option>
              <option value="MATERNITY">{dict.leave.types.MATERNITY}</option>
              <option value="STERILIZATION">{dict.leave.types.STERILIZATION}</option>
              <option value="MILITARY">{dict.leave.types.MILITARY}</option>
              <option value="TRAINING">{dict.leave.types.TRAINING}</option>
            </select>
          </Field>
          <Field label={dict.leave.fieldFrom}><input type="date" name="from" required className="input" /></Field>
          <Field label={dict.leave.fieldTo}><input type="date" name="to" required className="input" /></Field>
        </div>
        <Field label={dict.leave.fieldReason}><textarea name="reason" className="input min-h-[70px]" placeholder={dict.leave.reasonPlaceholder} /></Field>
        {result && <p className={`text-sm ${result.ok ? "text-brand-ink" : "text-danger"}`}>{result.message}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? dict.common.sending : dict.leave.submit}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
