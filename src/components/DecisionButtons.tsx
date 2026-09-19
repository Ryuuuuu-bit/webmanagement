"use client";

import { useTransition } from "react";
import { useLanguage } from "./LanguageProvider";

export default function DecisionButtons({
  onApprove,
  onReject,
}: {
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const { dict } = useLanguage();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-1.5">
      <button
        disabled={pending}
        onClick={() => startTransition(onApprove)}
        className="rounded-md border border-ok/40 px-2.5 py-1 text-xs font-semibold text-ok disabled:opacity-40"
      >
        {dict.common.approve}
      </button>
      <button
        disabled={pending}
        onClick={() => startTransition(onReject)}
        className="rounded-md border border-danger/40 px-2.5 py-1 text-xs font-semibold text-danger disabled:opacity-40"
      >
        {dict.common.reject}
      </button>
    </div>
  );
}
