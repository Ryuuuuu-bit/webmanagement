"use client";

import { useRef, useState, useTransition } from "react";
import type { LeaveType } from "@prisma/client";
import { useLanguage } from "./LanguageProvider";
import { useRouter } from "next/navigation";
import { encodeFileName, FileReadError, frameUpload, readFileBytes, xhrPost } from "@/lib/uploadClient";

const MAX_ATTACHMENT = 5 * 1024 * 1024;

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
  quotaStatus,
}: {
  quotaStatus: QuotaStatus[];
}) {
  const { dict } = useLanguage();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [halfDay, setHalfDay] = useState("");
  const [from, setFrom] = useState("");

  // Posts to a Route Handler (not a Server Action) as one framed body: the
  // text fields as length-prefixed JSON, then the optional attachment's
  // bytes read into memory first — see src/lib/uploadClient.ts (iOS Safari).
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const fields = {
      type: String(formData.get("type") ?? ""),
      from: String(formData.get("from") ?? ""),
      to: halfDay ? String(formData.get("from") ?? "") : String(formData.get("to") ?? ""),
      halfDay: String(formData.get("halfDay") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    };
    const picked = formData.get("file");
    const file = picked instanceof File && picked.size > 0 ? picked : null;
    if (file && file.size > MAX_ATTACHMENT) {
      setResult({ ok: false, message: dict.actions.leave.fileTooLarge });
      return;
    }
    startTransition(async () => {
      let res: ActionResult;
      try {
        const bytes = file ? await readFileBytes(file) : null;
        const headers: Record<string, string> = { "Content-Type": "application/octet-stream", "X-Upload-Framed": "1" };
        if (file) {
          headers["X-File-Name"] = encodeFileName(file.name);
          headers["X-File-Type"] = file.type || "";
        }
        const r = await xhrPost<ActionResult>("/api/leave/request", frameUpload(fields, bytes), { headers });
        res =
          r.json && typeof r.json.message === "string"
            ? r.json
            : { ok: false, message: r.status === 413 ? dict.actions.leave.fileTooLarge : dict.actions.upload.serverError(r.status) };
      } catch (err) {
        res = { ok: false, message: err instanceof FileReadError ? dict.actions.upload.readFailed : dict.actions.leave.uploadInterrupted };
      }
      setResult(res);
      if (res.ok) {
        form.reset();
        setHalfDay("");
        setFrom("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-bold">{dict.leave.quotaTitle}</h3>
        <p className="mt-0.5 text-xs text-muted">{dict.leave.quotaHint}</p>
        <div className="mt-2 overflow-x-auto rounded-lg border border-line-soft">
          <table className="w-full min-w-0 text-xs">
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
          <Field label={dict.leave.fieldDuration}>
            <select name="halfDay" value={halfDay} onChange={(e) => setHalfDay(e.target.value)} className="input">
              <option value="">{dict.leave.durationFull}</option>
              <option value="AM">{dict.leave.durationAm}</option>
              <option value="PM">{dict.leave.durationPm}</option>
            </select>
          </Field>
          <Field label={halfDay ? dict.leave.fieldDate : dict.leave.fieldFrom}>
            <input type="date" name="from" required value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
          </Field>
          {!halfDay && (
            <Field label={dict.leave.fieldTo}><input type="date" name="to" required min={from || undefined} className="input" /></Field>
          )}
        </div>
        <Field label={dict.leave.fieldReason}><textarea name="reason" className="input min-h-[70px]" placeholder={dict.leave.reasonPlaceholder} /></Field>
        <Field label={dict.leave.fieldAttachment}>
          <input type="file" name="file" accept=".pdf,image/*" className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-ink" />
          <span className="text-[11px] text-faint">{dict.leave.attachmentHint}</span>
        </Field>
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
