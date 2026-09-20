"use client";

import { useState, useTransition } from "react";
import type { PendingDeviceRow } from "@/actions/webauthn";
import { formatDate, formatTime } from "@/lib/date";
import { useLanguage } from "./LanguageProvider";

/** Admin: devices teachers registered themselves that are waiting for approval (policy deviceApprovalRequired). */
export default function PendingDevicesPanel({
  initial,
  decide,
}: {
  initial: PendingDeviceRow[];
  decide: (credentialDbId: string, approve: boolean) => Promise<{ ok: boolean; message: string }>;
}) {
  const { dict, locale } = useLanguage();
  const t = dict.checkin.pendingDevices;
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);

  if (rows.length === 0) return null;

  function onDecide(row: PendingDeviceRow, approve: boolean) {
    if (!approve && !confirm(t.rejectConfirm(row.userName))) return;
    startTransition(async () => {
      const res = await decide(row.id, approve);
      setMsg(res);
      if (res.ok) setRows((r) => r.filter((x) => x.id !== row.id));
    });
  }

  return (
    <div className="rounded-2xl border border-warn bg-warn-soft p-5 shadow-sm">
      <h2 className="text-base font-bold text-warn">{t.title(rows.length)}</h2>
      <p className="mt-1 text-sm text-warn opacity-90">{t.hint}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((r) => {
          const d = new Date(r.createdAt);
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
              <div>
                <span className="font-semibold">{r.userName}</span>
                <span className="ml-2 text-xs text-muted">{r.label || dict.checkin.unnamedDevice}</span>
                <span className="ml-2 text-xs text-faint">{formatDate(d, locale)} {formatTime(d, locale)}</span>
              </div>
              <div className="flex gap-2">
                <button disabled={pending} onClick={() => onDecide(r, false)} className="rounded-lg border border-danger px-3 py-1 text-xs font-semibold text-danger disabled:opacity-40">
                  {t.reject}
                </button>
                <button disabled={pending} onClick={() => onDecide(r, true)} className="rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
                  {t.approve}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.message}</p>}
    </div>
  );
}
