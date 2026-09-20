"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import { cancelLeave } from "@/actions/leave";

export default function CancelLeaveButton({ id }: { id: string }) {
  const { dict } = useLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function onClick() {
    if (!confirm(dict.leave.cancelConfirm)) return;
    startTransition(async () => {
      const res = await cancelLeave(id);
      if (!res.ok) setError(res.message);
      router.refresh();
    });
  }
  return (
    <span className="inline-flex flex-col">
      <button type="button" disabled={pending} onClick={onClick} className="whitespace-nowrap rounded-md border border-line px-2 py-0.5 text-[11px] font-semibold text-muted hover:text-danger disabled:opacity-40">
        {dict.leave.cancelButton}
      </button>
      {error && <span className="mt-1 text-[10px] text-danger">{error}</span>}
    </span>
  );
}
