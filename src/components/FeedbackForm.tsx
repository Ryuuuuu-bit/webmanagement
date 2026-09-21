"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import { encodeFileName, FileReadError, frameUpload, readFileBytes, xhrPost } from "@/lib/uploadClient";

const MAX_ATTACHMENT = 5 * 1024 * 1024;
const CATEGORIES = ["BUG", "SUGGESTION", "QUESTION", "OTHER"] as const;
const AREAS = ["dashboard", "schedule", "checkin", "leave", "attest", "lessonPlans", "notifications", "account", "admin", "other"] as const;

type Result = { ok: boolean; message: string };

/**
 * "รายงานปัญหา" form. Same upload path as leave/lesson plans (framed raw
 * body via XHR — src/lib/uploadClient.ts) so a screenshot from a phone
 * arrives intact. The page path is captured from the referrer-like
 * `document.referrer` fallback to "/feedback" so Admin can see where the
 * person came from.
 */
export default function FeedbackForm({ initialArea }: { initialArea?: string }) {
  const { dict } = useLanguage();
  const t = dict.feedback;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("BUG");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const picked = fd.get("file");
    const file = picked instanceof File && picked.size > 0 ? picked : null;
    setResult(null);
    if (file && file.size > MAX_ATTACHMENT) {
      setResult({ ok: false, message: dict.actions.feedback.fileTooLarge });
      return;
    }
    let pageUrl = "/feedback";
    try {
      const ref = document.referrer ? new URL(document.referrer) : null;
      if (ref && ref.origin === location.origin && ref.pathname !== "/feedback") pageUrl = ref.pathname + ref.search;
    } catch {}
    const fields = {
      category: String(fd.get("category") ?? ""),
      area: String(fd.get("area") ?? ""),
      title: String(fd.get("title") ?? ""),
      detail: String(fd.get("detail") ?? ""),
      pageUrl,
    };
    setBusy(true);
    setProgress(0);
    void (async () => {
      let res: Result;
      try {
        const bytes = file ? await readFileBytes(file) : null;
        const headers: Record<string, string> = { "Content-Type": "application/octet-stream", "X-Upload-Framed": "1" };
        if (file) {
          headers["X-File-Name"] = encodeFileName(file.name);
          headers["X-File-Type"] = file.type || "";
        }
        const r = await xhrPost<Result>("/api/feedback/report", frameUpload(fields, bytes), { headers, onProgress: setProgress });
        res =
          r.json && typeof r.json.message === "string"
            ? r.json
            : { ok: false, message: r.status === 413 ? dict.actions.feedback.fileTooLarge : dict.actions.upload.serverError(r.status) };
      } catch (err) {
        res = { ok: false, message: err instanceof FileReadError ? dict.actions.upload.readFailed : dict.actions.leave.uploadInterrupted };
      }
      setBusy(false);
      setResult(res);
      if (res.ok) {
        form.reset();
        setCategory("BUG");
        router.refresh();
      }
    })();
  }

  const catCls: Record<string, string> = {
    BUG: "border-danger text-danger bg-danger-soft",
    SUGGESTION: "border-brand text-brand-ink bg-brand-soft",
    QUESTION: "border-info text-info bg-info-soft",
    OTHER: "border-line text-subtle bg-line-soft",
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <input type="hidden" name="category" value={category} />
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">{t.fieldCategory}</label>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${category === c ? catCls[c] : "border-line text-muted hover:bg-line-soft"}`}
            >
              {t.categories[c]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label={t.fieldArea}>
          <select name="area" defaultValue={initialArea && (AREAS as readonly string[]).includes(initialArea) ? initialArea : "other"} className="input">
            {AREAS.map((a) => (
              <option key={a} value={a}>{t.areas[a]}</option>
            ))}
          </select>
        </Field>
        <Field label={t.fieldTitle}>
          <input name="title" required maxLength={120} placeholder={t.titlePlaceholder} className="input" />
        </Field>
      </div>
      <Field label={t.fieldDetail}>
        <textarea name="detail" required maxLength={4000} placeholder={t.detailPlaceholder} className="input min-h-[110px]" />
      </Field>
      <Field label={t.fieldAttachment}>
        <input
          type="file"
          name="file"
          accept="image/*,.pdf"
          disabled={busy}
          className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-ink"
        />
        <span className="text-[11px] text-faint">{t.attachmentHint}</span>
      </Field>
      {result && <p className={`text-sm ${result.ok ? "text-ok" : "text-danger"}`}>{result.message}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? `${dict.common.sending} ${progress > 0 ? `${progress}%` : ""}` : t.submit}
        </button>
        <span className="text-[11px] text-faint">{t.autoInfo}</span>
      </div>
    </form>
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
