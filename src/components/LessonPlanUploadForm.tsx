"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import { encodeFileName, FileReadError, readFileBytes, xhrPost } from "@/lib/uploadClient";

type Plan = {
  id: string;
  fileName: string;
  status: "PENDING" | "APPROVED" | "NEEDS_REVISION";
  reviewNote: string | null;
  submittedAt: string;
} | null;

const MAX_SIZE = 8 * 1024 * 1024;

/**
 * Reads the chosen file into memory, then XHR-POSTs the bytes raw to
 * /api/lesson-plans/upload (progress bar, readable errors, no multipart
 * parser in the loop — see src/lib/uploadClient.ts for the iOS Safari
 * background).
 */
export default function LessonPlanUploadForm({
  courseId,
  courseLabel,
  plan,
}: {
  courseId: string;
  courseLabel: string;
  plan: Plan;
}) {
  const { dict, locale } = useLanguage();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    setResult(null);
    if (!(file instanceof File) || file.size === 0) {
      setResult({ ok: false, message: dict.actions.lessonPlans.pleaseSelectFile });
      return;
    }
    if (file.size > MAX_SIZE) {
      setResult({ ok: false, message: dict.actions.lessonPlans.fileTooLarge });
      return;
    }
    setBusy(true);
    setProgress(0);
    void (async () => {
      let res: { ok: boolean; message: string };
      try {
        // Read into memory first — see src/lib/uploadClient.ts for the iOS story.
        const bytes = await readFileBytes(file);
        const r = await xhrPost<{ ok: boolean; message: string }>(
          `/api/lesson-plans/upload?courseId=${encodeURIComponent(courseId)}`,
          bytes,
          {
            headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeFileName(file.name), "X-File-Type": file.type || "" },
            onProgress: setProgress,
          }
        );
        res =
          r.json && typeof r.json.message === "string"
            ? r.json
            : { ok: false, message: r.status === 413 ? dict.actions.lessonPlans.fileTooLarge : dict.actions.upload.serverError(r.status) };
      } catch (err) {
        res = { ok: false, message: err instanceof FileReadError ? dict.actions.upload.readFailed : dict.actions.lessonPlans.uploadInterrupted };
      }
      setBusy(false);
      setResult(res);
      if (res.ok) {
        form.reset();
        router.refresh();
      }
    })();
  }

  const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
    PENDING: { text: dict.lessonPlans.statusPendingUpload, cls: "bg-info-soft text-info" },
    APPROVED: { text: dict.lessonPlans.statusApproved, cls: "bg-ok-soft text-ok" },
    NEEDS_REVISION: { text: dict.lessonPlans.statusNeedsRevisionUpload, cls: "bg-warn-soft text-warn" },
  };

  const status = plan ? STATUS_LABEL[plan.status] : null;

  return (
    <div className="border-t border-line-soft py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{courseLabel}</span>
        {status && <span className={`badge ${status.cls}`}>{status.text}</span>}
      </div>

      {plan && (
        <div className="mt-2 text-sm text-subtle">
          <a href={`/api/lesson-plans/${plan.id}`} className="break-all font-semibold text-brand-ink underline">
            {plan.fileName}
          </a>
          <span className="ml-2 text-faint">
            {dict.lessonPlans.lastSubmitted} {new Date(plan.submittedAt).toLocaleString(locale === "en" ? "en-US" : "th-TH")}
          </span>
          {plan.status === "NEEDS_REVISION" && plan.reviewNote && (
            <p className="mt-1 rounded-lg bg-warn-soft p-2 text-xs text-warn">{dict.lessonPlans.adminRequestedChanges} {plan.reviewNote}</p>
          )}
        </div>
      )}

      <form ref={formRef} onSubmit={onSubmit} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="hidden" name="courseId" value={courseId} />
        <input name="file" type="file" required accept=".pdf,.doc,.docx,.ppt,.pptx" disabled={busy} className="max-w-full text-sm" />
        <button type="submit" disabled={busy} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
          {busy ? `${dict.lessonPlans.sending} ${progress}%` : plan ? dict.lessonPlans.submitNew : dict.lessonPlans.submitFirst}
        </button>
        {busy && (
          <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-line-soft">
            <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
        {result && <span className={`text-xs ${result.ok ? "text-brand-ink" : "text-danger"}`}>{result.message}</span>}
      </form>
      <p className="mt-1 text-[11px] text-faint">{dict.lessonPlans.uploadHint}</p>
    </div>
  );
}
