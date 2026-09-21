"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import { AttendanceBadge, RequestBadge } from "./StatusBadge";
import { formatDate, formatTime, formatTimeLabel } from "@/lib/date";
import type { RecordKind } from "@/actions/records";
import EditAttendanceButton from "./EditAttendanceButton";
import TableFilter from "./TableFilter";

type AttendanceRow = {
  id: string;
  date: string;
  dayKey: string;
  checkinAt: string | null;
  checkoutAt: string | null;
  status: string;
  attestedCheckin: boolean;
  attestedCheckout: boolean;
  checkinMethod: string | null;
  checkoutMethod: string | null;
  flagSharedDevice: boolean;
  checkinSelfieId: string | null;
  checkoutSelfieId: string | null;
};
type LeaveRow = { id: string; dayKey: string; type: string; startDate: string; endDate: string; reason: string; status: string; createdAt: string };
type AttestRow = { id: string; dayKey: string; type: string; date: string; requestedTime: string; requestedCheckoutTime: string | null; reason: string; status: string };
type LessonPlanRow = { id: string; dayKey: string; courseCode: string; courseName: string; fileName: string; fileSize: number; status: string; submittedAt: string };

type Result = { ok: boolean; message: string };

export default function UserHistoryClient({
  userId,
  userName,
  attendance,
  leave,
  attest,
  lessonPlans,
  deleteRecord,
  clearRecords,
}: {
  userId: string;
  userName: string;
  attendance: AttendanceRow[];
  leave: LeaveRow[];
  attest: AttestRow[];
  lessonPlans: LessonPlanRow[];
  deleteRecord: (kind: RecordKind, id: string) => Promise<Result>;
  clearRecords: (kind: RecordKind, userId: string) => Promise<Result>;
}) {
  const { dict, locale } = useLanguage();
  const t = dict.history;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ kind: RecordKind } & Result | null>(null);

  function onDelete(kind: RecordKind, id: string) {
    if (!confirm(t.confirmOne)) return;
    startTransition(async () => {
      const res = await deleteRecord(kind, id);
      setResult({ kind, ...res });
      router.refresh();
    });
  }

  function onClear(kind: RecordKind, count: number) {
    if (count === 0) return;
    if (!confirm(t.confirmClear(t.sections[kind], userName, count))) return;
    startTransition(async () => {
      const res = await clearRecords(kind, userId);
      setResult({ kind, ...res });
      router.refresh();
    });
  }

  const delBtn = "whitespace-nowrap rounded-lg border border-danger px-2 py-0.5 text-[11px] font-semibold text-danger hover:bg-danger-soft disabled:opacity-40";

  // Plain render helper (not a nested component) so React doesn't remount
  // the tables on every state change.
  const Section = ({ kind, count, children }: { kind: RecordKind; count: number; children: React.ReactNode }) => (
    <section id={`history-${kind}`} className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">
          {t.sections[kind]} <span className="ml-1 text-xs font-normal text-faint">{t.count(count)}</span>
        </h2>
        <button disabled={pending || count === 0} onClick={() => onClear(kind, count)} className={delBtn}>
          {t.clearSection}
        </button>
      </div>
      {result?.kind === kind && <p className={`mb-2 text-xs ${result.ok ? "text-ok" : "text-danger"}`}>{result.message}</p>}
      {count === 0 ? (
        <p className="text-sm text-muted">{t.empty}</p>
      ) : (
        <>
          <TableFilter targetId={`history-${kind}`} dateRange pageSize={50} />
          <div className="overflow-x-auto">{children}</div>
        </>
      )}
    </section>
  );

  const hhmm = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }) : "";
  const th = "pb-2 text-left text-xs uppercase text-faint";
  const td = "py-2 align-top";

  return (
    <div className="flex flex-col gap-5">
      {Section({ kind: "attendance", count: attendance.length, children: (
        <table className="table-stack w-full text-sm">
          <thead>
            <tr>
              <th className={th}>{t.colDate}</th>
              <th className={th}>{t.colCheckin}</th>
              <th className={th}>{t.colCheckout}</th>
              <th className={th}>{t.colStatus}</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {attendance.map((a) => (
              <tr key={a.id} data-date={a.dayKey} className="border-t border-line-soft">
                <td className={td}>{formatDate(a.date, locale)}</td>
                <td className={td}>
                  {formatTime(a.checkinAt ? new Date(a.checkinAt) : null, locale) ?? "—"}
                  {a.attestedCheckin && <span className="ml-1 text-[10px] text-faint">({t.attested})</span>}
                  {a.checkinMethod === "webauthn" && <span className="ml-1 text-[10px]">🔒</span>}
                  {a.checkinSelfieId && <Thumb id={a.checkinSelfieId} />}
                </td>
                <td className={td}>
                  {formatTime(a.checkoutAt ? new Date(a.checkoutAt) : null, locale) ?? "—"}
                  {a.attestedCheckout && <span className="ml-1 text-[10px] text-faint">({t.attested})</span>}
                  {a.checkoutMethod === "webauthn" && <span className="ml-1 text-[10px]">🔒</span>}
                  {a.checkoutSelfieId && <Thumb id={a.checkoutSelfieId} />}
                </td>
                <td className={td}>
                  <AttendanceBadge status={a.status} dict={dict} />
                  {a.flagSharedDevice && <span className="badge ml-1 bg-danger-soft text-danger">{t.sharedDevice}</span>}
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <EditAttendanceButton
                    id={a.id}
                    label={`${userName} · ${formatDate(a.date, locale)}`}
                    checkin={hhmm(a.checkinAt)}
                    checkout={hhmm(a.checkoutAt)}
                    status={a.status}
                  />{" "}
                  <button disabled={pending} onClick={() => onDelete("attendance", a.id)} className={delBtn}>{t.deleteOne}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) })}

      {Section({ kind: "leave", count: leave.length, children: (
        <table className="table-stack w-full text-sm">
          <thead>
            <tr>
              <th className={th}>{t.colType}</th>
              <th className={th}>{t.colRange}</th>
              <th className={th}>{t.colReason}</th>
              <th className={th}>{t.colStatus}</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {leave.map((l) => (
              <tr key={l.id} data-date={l.dayKey} className="border-t border-line-soft">
                <td className={td}>{(dict.leave.types as Record<string, string>)[l.type] ?? l.type}</td>
                <td className={td}>{formatDate(l.startDate, locale)} – {formatDate(l.endDate, locale)}</td>
                <td className={`${td} max-w-[240px] truncate`} title={l.reason}>{l.reason}</td>
                <td className={td}><RequestBadge status={l.status} dict={dict} /></td>
                <td className={`${td} text-right`}>
                  <button disabled={pending} onClick={() => onDelete("leave", l.id)} className={delBtn}>{t.deleteOne}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) })}

      {Section({ kind: "attest", count: attest.length, children: (
        <table className="table-stack w-full text-sm">
          <thead>
            <tr>
              <th className={th}>{t.colDate}</th>
              <th className={th}>{t.colType}</th>
              <th className={th}>{t.colTime}</th>
              <th className={th}>{t.colReason}</th>
              <th className={th}>{t.colStatus}</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {attest.map((a) => (
              <tr key={a.id} data-date={a.dayKey} className="border-t border-line-soft">
                <td className={td}>{formatDate(a.date, locale)}</td>
                <td className={td}>{(dict.attest.types as Record<string, string>)[a.type] ?? a.type}</td>
                <td className={td}>
                  {formatTimeLabel(a.requestedTime, locale)}
                  {a.requestedCheckoutTime && ` / ${formatTimeLabel(a.requestedCheckoutTime, locale)}`}
                </td>
                <td className={`${td} max-w-[240px] truncate`} title={a.reason}>{a.reason}</td>
                <td className={td}><RequestBadge status={a.status} dict={dict} /></td>
                <td className={`${td} text-right`}>
                  <button disabled={pending} onClick={() => onDelete("attest", a.id)} className={delBtn}>{t.deleteOne}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) })}

      {Section({ kind: "lessonPlan", count: lessonPlans.length, children: (
        <table className="table-stack w-full text-sm">
          <thead>
            <tr>
              <th className={th}>{t.colCourse}</th>
              <th className={th}>{t.colFile}</th>
              <th className={th}>{t.colSubmitted}</th>
              <th className={th}>{t.colStatus}</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {lessonPlans.map((p) => (
              <tr key={p.id} data-date={p.dayKey} className="border-t border-line-soft">
                <td className={td}>{p.courseCode} <span className="text-muted">{p.courseName}</span></td>
                <td className={`${td} max-w-[240px] truncate`} title={p.fileName}>
                  {p.fileName} <span className="text-[11px] text-faint">({(p.fileSize / 1024 / 1024).toFixed(1)} MB)</span>
                </td>
                <td className={td}>{formatDate(p.submittedAt, locale)}</td>
                <td className={td}>
                  <span className={`badge ${p.status === "APPROVED" ? "bg-ok-soft text-ok" : p.status === "NEEDS_REVISION" ? "bg-warn-soft text-warn" : "bg-line-soft text-muted"}`}>
                    {(t.lessonStatus as Record<string, string>)[p.status] ?? p.status}
                  </span>
                </td>
                <td className={`${td} text-right`}>
                  <button disabled={pending} onClick={() => onDelete("lessonPlan", p.id)} className={delBtn}>{t.deleteOne}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) })}
    </div>
  );
}

function Thumb({ id }: { id: string }) {
  return (
    <a href={`/api/selfies/${id}`} target="_blank" rel="noopener" className="ml-1 inline-block align-middle">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/selfies/${id}`} alt="" className="h-6 w-6 rounded object-cover ring-1 ring-line" />
    </a>
  );
}
