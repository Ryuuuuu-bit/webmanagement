"use client";

import { useState, useTransition } from "react";
import { formatDate } from "@/lib/date";
import { useLanguage } from "./LanguageProvider";

type Plan = {
  id: string;
  fileName: string;
  status: "PENDING" | "APPROVED" | "NEEDS_REVISION";
  reviewNote: string | null;
  submittedAt: string;
  teacher: { name: string };
  course: { code: string; name: string };
};

export default function LessonPlanReviewRow({
  plan,
  reviewLessonPlan,
}: {
  plan: Plan;
  reviewLessonPlan: (id: string, decision: "APPROVED" | "NEEDS_REVISION", note: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const { dict, locale } = useLanguage();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [showNoteBox, setShowNoteBox] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function decide(decision: "APPROVED" | "NEEDS_REVISION") {
    startTransition(async () => {
      const res = await reviewLessonPlan(plan.id, decision, note);
      setResult(res);
      if (res.ok) setShowNoteBox(false);
    });
  }

  const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
    PENDING: { text: dict.lessonPlans.statusPendingReview, cls: "bg-info-soft text-info" },
    APPROVED: { text: dict.lessonPlans.statusApproved, cls: "bg-ok-soft text-ok" },
    NEEDS_REVISION: { text: dict.lessonPlans.statusNeedsRevisionReview, cls: "bg-warn-soft text-warn" },
  };

  const status = STATUS_LABEL[plan.status];

  return (
    <tr data-status={plan.status} className="border-t border-line-soft align-top">
      <td className="py-2">{plan.teacher.name}</td>
      <td className="py-2">{plan.course.code} {plan.course.name}</td>
      <td className="py-2 pr-3">
        <a
          href={`/api/lesson-plans/${plan.id}`}
          title={plan.fileName}
          className="inline-block max-w-[240px] truncate align-bottom font-semibold text-brand-ink underline max-sm:max-w-full max-sm:break-all"
        >
          {plan.fileName}
        </a>
      </td>
      <td className="whitespace-nowrap py-2 pr-3 text-faint">{formatDate(plan.submittedAt, locale)}</td>
      <td className="py-2"><span className={`badge ${status.cls}`}>{status.text}</span></td>
      <td className="py-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <button disabled={pending} onClick={() => decide("APPROVED")} className="rounded-lg border border-ok px-2.5 py-1 text-xs font-semibold text-ok hover:bg-ok-soft disabled:opacity-40">
              {dict.lessonPlans.approveAction}
            </button>
            <button disabled={pending} onClick={() => setShowNoteBox((v) => !v)} className="rounded-lg border border-warn px-2.5 py-1 text-xs font-semibold text-warn hover:bg-warn-soft disabled:opacity-40">
              {dict.lessonPlans.requestChangesAction}
            </button>
          </div>
          {showNoteBox && (
            <div className="flex flex-col gap-1.5">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={dict.lessonPlans.requestChangesPlaceholder}
                className="input min-w-[200px] text-xs"
                rows={2}
              />
              <button disabled={pending} onClick={() => decide("NEEDS_REVISION")} className="w-fit rounded-lg bg-warn px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">
                {pending ? dict.lessonPlans.sending : dict.lessonPlans.sendBackAction}
              </button>
            </div>
          )}
          {result && <span className={`text-xs ${result.ok ? "text-ok" : "text-danger"}`}>{result.message}</span>}
        </div>
      </td>
    </tr>
  );
}
