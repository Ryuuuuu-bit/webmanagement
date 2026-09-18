"use client";

import { useTransition } from "react";

export default function DeleteButton({ action }: { action: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (confirm("ลบตารางสอนนี้ใช่ไหม?")) startTransition(action);
      }}
      className="self-end text-[10px] font-semibold text-danger disabled:opacity-40"
    >
      ลบ
    </button>
  );
}
