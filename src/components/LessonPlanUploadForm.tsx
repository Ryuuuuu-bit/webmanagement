"use client";

import { useRef, useState, useTransition } from "react";

type Plan = {
  id: string;
  fileName: string;
  status: "PENDING" | "APPROVED" | "NEEDS_REVISION";
  reviewNote: string | null;
  submittedAt: string;
} | null;

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  PENDING: { text: "รอ Admin ตรวจสอบ", cls: "bg-info-soft text-info" },
  APPROVED: { text: "อนุมัติแล้ว", cls: "bg-ok-soft text-ok" },
  NEEDS_REVISION: { text: "ต้องแก้ไข", cls: "bg-warn-soft text-warn" },
};

export default function LessonPlanUploadForm({
  courseId,
  courseLabel,
  plan,
  submitLessonPlan,
}: {
  courseId: string;
  courseLabel: string;
  plan: Plan;
  submitLessonPlan: (_prev: { ok: boolean; message: string } | null, formData: FormData) => Promise<{ ok: boolean; message: string }>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await submitLessonPlan(null, formData);
      setResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  const status = plan ? STATUS_LABEL[plan.status] : null;

  return (
    <div className="border-t border-line-soft py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{courseLabel}</span>
        {status && <span className={`badge ${status.cls}`}>{status.text}</span>}
      </div>

      {plan && (
        <div className="mt-2 text-sm text-subtle">
          <a href={`/api/lesson-plans/${plan.id}`} className="font-semibold text-brand-ink underline">
            {plan.fileName}
          </a>
          <span className="ml-2 text-faint">ส่งล่าสุด {new Date(plan.submittedAt).toLocaleString("th-TH")}</span>
          {plan.status === "NEEDS_REVISION" && plan.reviewNote && (
            <p className="mt-1 rounded-lg bg-warn-soft p-2 text-xs text-warn">Admin ขอให้แก้ไข: {plan.reviewNote}</p>
          )}
        </div>
      )}

      <form ref={formRef} onSubmit={onSubmit} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="hidden" name="courseId" value={courseId} />
        <input name="file" type="file" required accept=".pdf,.doc,.docx,.ppt,.pptx" className="text-sm" />
        <button type="submit" disabled={pending} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
          {pending ? "กำลังส่ง..." : plan ? "ส่งไฟล์ใหม่" : "ส่งแผนการสอน"}
        </button>
        {result && <span className={`text-xs ${result.ok ? "text-brand-ink" : "text-danger"}`}>{result.message}</span>}
      </form>
    </div>
  );
}
