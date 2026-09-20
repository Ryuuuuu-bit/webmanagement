"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import { deleteRecord, type RecordKind } from "@/actions/records";

/**
 * Small "ลบ" button for a single history record on the admin overview
 * tables (check-in overview, leave/attestation lists, ...). Same server
 * action and audit trail as the per-user history page.
 */
export default function DeleteRecordButton({ kind, id, label }: { kind: RecordKind; id: string; label?: string }) {
  const { dict } = useLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (!confirm(label ? `${label}\n\n${dict.history.confirmOne}` : dict.history.confirmOne)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteRecord(kind, id);
      if (!res.ok) setError(res.message);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={onClick}
        className="whitespace-nowrap rounded-lg border border-danger px-2 py-0.5 text-[11px] font-semibold text-danger hover:bg-danger-soft disabled:opacity-40"
      >
        {dict.history.deleteOne}
      </button>
      {error && <span className="mt-1 text-[10px] text-danger">{error}</span>}
    </span>
  );
}
