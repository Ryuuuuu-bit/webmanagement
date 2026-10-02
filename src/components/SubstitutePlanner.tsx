"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { GradeLevel } from "@prisma/client";
import { useLanguage } from "./LanguageProvider";
import type { AbsentTeacher, BoardColumn, BoardRow, Candidate, Slot } from "@/lib/substitutes";

type ActionResult = { ok: boolean; message: string };

const REASON_TONE: Record<string, string> = {
  LEAVE: "bg-info-soft text-info",
  LEAVE_PENDING: "bg-warn-soft text-warn",
  ABSENT: "bg-danger-soft text-danger",
  NOT_CHECKED_IN: "bg-danger-soft text-danger",
  MANUAL: "bg-line-soft text-subtle",
  BOOKED: "bg-line-soft text-subtle",
};

/**
 * Substitute planner for one school and day: summary → classes that need
 * cover → teacher × class-time grid. Picking a class highlights its column,
 * turns the free cells of teachers who can cover into ranked "Pick" buttons
 * and opens the panel (bottom sheet on phones) with the ranked list, the
 * reasons others can't cover, and an inline confirmation.
 */
export default function SubstitutePlanner({
  dateKey,
  isToday,
  out,
  waiting,
  slots,
  columns,
  rows,
  assign,
  cancel,
}: {
  dateKey: string;
  isToday: boolean;
  out: AbsentTeacher[];
  waiting: { id: string; name: string; until: string }[];
  slots: Slot[];
  columns: BoardColumn[];
  rows: BoardRow[];
  assign: (dateKey: string, scheduleId: string, substituteId: string) => Promise<ActionResult>;
  cancel: (id: string) => Promise<ActionResult>;
}) {
  const { dict } = useLanguage();
  const t = dict.substitutes;
  const b = t.board;
  const grade = (g: string) => dict.grades[g as GradeLevel] ?? g;

  const [picked, setPicked] = useState<string | null>(null); // scheduleId
  const [confirmFor, setConfirmFor] = useState<string | null>(null); // candidate id
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [advance, setAdvance] = useState(false);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);

  const isOpen = (s: Slot) => !s.booking || s.booking.unavailable;
  const openCount = slots.filter(isOpen).length;
  const doneCount = slots.length - openCount;
  const slot = slots.find((s) => s.scheduleId === picked) ?? null;
  const pickedCol = slot ? columns.findIndex((c) => c.start === slot.start && c.end === slot.end) : -1;

  // Reset when the day/school changes; after a booking, jump to the next class still open.
  useEffect(() => {
    if (picked && !slots.some((s) => s.scheduleId === picked)) setPicked(null);
    if (advance) {
      setAdvance(false);
      const next = slots.find(isOpen);
      setPicked(next ? next.scheduleId : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const choose = (id: string | null) => {
    setPicked((cur) => (cur === id ? null : id));
    setConfirmFor(null);
    setConfirmCancel(false);
  };
  const doAssign = () => {
    if (!slot || !confirmFor) return;
    startTransition(async () => {
      const res = await assign(dateKey, slot.scheduleId, confirmFor);
      setToast(res);
      if (res.ok) {
        setConfirmFor(null);
        setAdvance(true);
      }
    });
  };
  const doCancel = () => {
    if (!slot?.booking) return;
    const id = slot.booking.id;
    startTransition(async () => {
      const res = await cancel(id);
      setToast(res);
      setConfirmCancel(false);
    });
  };

  const candidates = slot?.candidates ?? [];
  const rank = useMemo(() => new Map(candidates.map((c, i) => [c.id, i + 1])), [candidates]);
  const excludedBy = useMemo(() => new Map((slot?.excluded ?? []).map((x) => [x.id, x])), [slot]);
  const nameById = useMemo(() => new Map(rows.map((r) => [r.id, r.name])), [rows]);
  const reasonText = (x: Slot["excluded"][number]) => {
    switch (x.reason) {
      case "OWN_CLASS": return b.exclude.OWN_CLASS(x.detail ?? "");
      case "COVERING": return b.exclude.COVERING(x.detail ?? "—");
      case "GRADE": return b.exclude.GRADE((x.detail ?? "").split(",").filter(Boolean).map(grade).join(", "));
      default: return b.exclude[x.reason];
    }
  };

  return (
    <>
      {/* summary */}
      <section className="card grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-2">
            <strong className="tabular text-3xl font-bold leading-none">{openCount}</strong>
            <span className="text-sm text-muted">{b.openBig}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-danger-soft" aria-hidden>
            <i className="block h-full bg-ok transition-all" style={{ width: slots.length ? `${(doneCount / slots.length) * 100}%` : "100%" }} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-danger" />{b.needCount} <b>{slots.length}</b></span>
            <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-ok" />{b.doneCount} <b>{doneCount}</b></span>
            {isToday && <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warn" />{b.waitingCount(waiting.length)}</span>}
          </div>
        </div>
        <div className="min-w-0">
          <h2 className="mb-2 text-sm font-bold">{b.outTitle}</h2>
          {out.length === 0 && waiting.length === 0 ? (
            <p className="text-sm text-muted">{b.everyoneIn}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {out.map((a) => {
                const open = a.slots.filter(isOpen).length;
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-line px-3 py-2">
                    <span className="text-sm font-semibold">{a.name}</span>
                    <span className={`badge ${REASON_TONE[a.reason]}`}>
                      {t.reasons[a.reason]}{a.halfDay ? ` (${a.halfDay === "AM" ? t.halfAm : t.halfPm})` : ""}
                    </span>
                    <span className={`ml-auto text-xs ${open ? "text-danger" : "text-muted"}`}>
                      {a.dayOff ? t.dayOff : a.slots.length === 0 ? b.noNeed : open ? b.needN(open) : b.coveredAll}
                    </span>
                  </li>
                );
              })}
              {waiting.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-dashed border-line-strong px-3 py-2">
                  <span className="text-sm font-semibold">{w.name}</span>
                  <span className="badge bg-warn-soft text-warn">{b.waitingBadge}</span>
                  <span className="ml-auto text-xs text-muted">{b.waitingUntil(w.until)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* classes that need cover */}
      <section className="card flex flex-col gap-2.5 p-4">
        <h2 className="text-sm font-bold">
          {b.openTitle} <span className="font-normal text-muted">{b.openHint}</span>
        </h2>
        {slots.length === 0 ? (
          <p className="text-sm text-muted">{b.noOpen}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {slots.map((s) => {
              const open = isOpen(s);
              return (
                <button
                  key={s.scheduleId}
                  type="button"
                  onClick={() => choose(s.scheduleId)}
                  aria-pressed={picked === s.scheduleId}
                  className={`flex min-w-0 max-w-full flex-col items-start rounded-xl border-[1.5px] px-3 py-1.5 text-left ${
                    open ? "border-dashed border-danger bg-danger-soft" : "border-ok bg-ok-soft"
                  } ${picked === s.scheduleId ? (open ? "ring-2 ring-danger ring-offset-1 ring-offset-surface" : "ring-2 ring-ok ring-offset-1 ring-offset-surface") : ""}`}
                >
                  <span className={`tabular font-mono text-xs font-semibold ${open ? "text-danger" : "text-ok"}`}>{s.start}–{s.end}</span>
                  <span className="max-w-[16rem] truncate text-sm font-semibold">{s.courseCode} {s.courseName}</span>
                  <span className="max-w-[16rem] truncate text-[11px] text-muted">
                    {s.booking ? (s.booking.unavailable ? `⚠ ${s.booking.name}` : b.coveredBy(s.booking.name)) : b.forName(s.ownerName)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* grid */}
        <section className="card flex min-w-0 flex-col gap-2.5 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold">{b.gridTitle}</h2>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-subtle">
              <Legend cls="bg-[var(--color-line-soft)] border-line-strong">{b.legendOwn}</Legend>
              <Legend cls="bg-danger-soft border-dashed border-danger">{b.legendNeed}</Legend>
              <Legend cls="bg-ok-soft border-ok">{b.legendCovered}</Legend>
              <Legend cls="bg-info-soft border-info">{b.legendCovering}</Legend>
              <Legend cls="sub-hatch border-line-strong">{b.legendOff}</Legend>
              <Legend cls="bg-surface border-line-strong">{b.legendFree}</Legend>
            </div>
          </div>
          {columns.length === 0 ? (
            <p className="text-sm text-muted">{b.noColumns}</p>
          ) : (
            <div className="sub-scroll overflow-x-auto rounded-xl border border-line">
              <table className="sub-grid w-full border-separate border-spacing-0 text-left" style={{ minWidth: 200 + columns.length * 118 }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 z-20 min-w-[11.5rem] border-b border-r border-line-soft bg-surface px-3 py-2 text-xs font-semibold">{b.colTeacher}</th>
                    {columns.map((c, i) => (
                      <th key={`${c.start}${c.end}`} className={`border-b border-r border-line-soft px-2 py-2 text-xs font-semibold ${i === pickedCol ? "bg-brand-soft" : "bg-surface"}`}>
                        <span className="tabular font-mono text-[11px]">{c.start}–{c.end}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const p = r.presence;
                    return (
                      <tr key={r.id}>
                        <th scope="row" className={`sticky left-0 z-10 max-w-[13rem] border-b border-r border-line-soft px-3 py-2 align-top font-normal ${p.kind === "OUT" ? "bg-[color-mix(in_srgb,var(--color-danger-soft)_70%,var(--color-surface))]" : "bg-surface"}`}>
                          <span className="block truncate text-[13px] font-semibold">{r.name}</span>
                          <span className="block truncate text-[11px] text-muted">
                            {[r.department, r.gradeLevels.map(grade).join(", ")].filter(Boolean).join(" · ")}
                          </span>
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {p.kind === "IN" && <span className={`badge !px-2 !py-0 !text-[11px] ${p.late ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok"}`}>{p.late ? b.lateIn(p.at) : b.checkedIn(p.at)}</span>}
                            {p.kind === "WAITING" && <span className="badge !px-2 !py-0 !text-[11px] bg-warn-soft text-warn">{b.waitingBadge}</span>}
                            {p.kind === "OUT" && (
                              <span className={`badge !px-2 !py-0 !text-[11px] ${REASON_TONE[p.reason]}`}>
                                {t.reasons[p.reason]}{p.halfDay ? ` (${p.halfDay === "AM" ? t.halfAm : t.halfPm})` : ""}
                              </span>
                            )}
                            {r.extraSite && <span className="text-[11px] text-faint">{b.extraSite}</span>}
                          </span>
                        </th>
                        {r.cells.map((cell, i) => {
                          const sel = i === pickedCol;
                          let inner: React.ReactNode;
                          if (cell.type === "need" || cell.type === "covered") {
                            const covered = cell.type === "covered" && !cell.unavailable;
                            inner = (
                              <button
                                type="button"
                                onClick={() => choose(cell.scheduleId)}
                                aria-pressed={picked === cell.scheduleId}
                                className={`flex h-full w-full flex-col justify-center rounded-lg px-2 py-1.5 text-left text-xs ${
                                  covered ? "border-[1.5px] border-ok bg-ok-soft" : "border-[1.5px] border-dashed border-danger bg-danger-soft"
                                } ${picked === cell.scheduleId ? "ring-2 ring-offset-1 ring-offset-surface " + (covered ? "ring-ok" : "ring-danger") : ""}`}
                              >
                                <span className={`font-semibold ${covered ? "" : "text-danger"}`}>{cell.code}</span>
                                <span className={`truncate text-[11px] ${covered ? "font-semibold text-ok" : "text-muted"}`}>
                                  {cell.type === "covered" ? (cell.unavailable ? `⚠ ${cell.by}` : `✓ ${cell.by}`) : `${b.cellNeed} · ${cell.room}`}
                                </span>
                              </button>
                            );
                          } else if (cell.type === "class") {
                            inner = (
                              <div className="flex h-full flex-col justify-center rounded-lg bg-line-soft px-2 py-1.5 text-xs">
                                <span className="font-semibold">{cell.code}</span>
                                <span className="truncate text-[11px] text-muted">{cell.room}</span>
                              </div>
                            );
                          } else if (cell.type === "covering") {
                            inner = (
                              <div className="flex h-full flex-col justify-center rounded-lg border border-info bg-info-soft px-2 py-1.5 text-xs">
                                <span className="font-semibold text-info">{b.cellCovering(cell.code)}</span>
                                <span className="truncate text-[11px] text-muted">{b.cellOf(cell.forName)}</span>
                              </div>
                            );
                          } else if (cell.type === "off") {
                            inner = <div className="sub-hatch flex h-full items-center rounded-lg px-2 text-[11px] text-faint">{b.cellOff}</div>;
                          } else if (cell.type === "busy") {
                            inner = <div className="flex h-full items-center rounded-lg bg-line-soft px-2 text-[11px] text-faint">{b.cellBusy}</div>;
                          } else if (sel && rank.has(r.id)) {
                            const c = candidates.find((x) => x.id === r.id)!;
                            inner = (
                              <button
                                type="button"
                                onClick={() => { setConfirmFor(r.id); setConfirmCancel(false); panelRef.current?.scrollTo({ top: 0 }); }}
                                className={`flex h-full w-full items-center gap-1.5 rounded-lg border-[1.5px] bg-surface px-2 py-1.5 text-left text-xs font-semibold shadow-card ${c.waiting ? "border-warn text-warn" : "border-brand text-brand-ink"}`}
                              >
                                <span className={`inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[11px] text-white ${c.waiting ? "bg-warn" : "bg-brand"}`}>{rank.get(r.id)}</span>
                                <span className="flex min-w-0 flex-col">
                                  {b.pick}
                                  {c.waiting && <span className="truncate text-[10px] font-normal">{b.waitingBadge}</span>}
                                </span>
                              </button>
                            );
                          } else if (sel && excludedBy.has(r.id)) {
                            inner = <div className="flex h-full items-center px-1 text-[11px] leading-tight text-faint">{reasonText(excludedBy.get(r.id)!)}</div>;
                          } else {
                            inner = <div className="flex h-full items-center px-2 text-[11px] text-faint">{b.cellFree}</div>;
                          }
                          return (
                            <td key={i} className={`h-[3.6rem] border-b border-r border-line-soft p-1 align-top ${sel ? "bg-brand-soft" : ""}`}>
                              {inner}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-faint lg:hidden">{b.scrollHint}</p>
        </section>

        {/* panel / bottom sheet */}
        {slot && <button type="button" aria-label={b.close} onClick={() => choose(null)} className="fixed inset-0 z-40 bg-black/30 lg:hidden" />}
        <aside
          ref={panelRef}
          aria-live="polite"
          className={`card flex flex-col gap-3 p-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-auto ${
            slot ? "fixed inset-x-0 bottom-0 z-50 max-h-[78dvh] overflow-auto rounded-b-none pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-pop sheet-up lg:static lg:z-auto lg:max-h-none lg:rounded-2xl lg:pb-4 lg:shadow-card lg:[animation:none]" : "hidden lg:flex"
          }`}
        >
          {!slot ? (
            <div className="flex flex-col gap-2 text-sm text-muted">
              <h2 className="text-base font-bold text-ink">{b.emptyTitle}</h2>
              <ol className="ml-4 flex list-decimal flex-col gap-1">
                {b.emptySteps.map((x) => <li key={x}>{x}</li>)}
              </ol>
              <p className="text-xs">{b.rankRule}</p>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => choose(null)} className="btn-secondary btn-sm self-end lg:hidden">{b.close}</button>
              <div className="flex flex-col gap-1 border-b border-line pb-3">
                <span className="tabular font-mono text-sm font-semibold text-danger">{slot.start}–{slot.end}</span>
                <span className="text-base font-bold">{slot.courseName}</span>
                <span className="text-xs text-muted">
                  {slot.courseCode}{slot.gradeLevel ? ` · ${grade(slot.gradeLevel)}` : ""} · {slot.room} · {b.forName(slot.ownerName)}
                </span>
                {!slot.gradeLevel && <span className="text-[11px] text-faint">{t.noGrade}</span>}
              </div>

              {slot.booking && !confirmFor && (
                <div className={`flex flex-col gap-2 rounded-xl border-[1.5px] p-3 ${slot.booking.unavailable ? "border-danger bg-danger-soft" : "border-ok bg-ok-soft"}`}>
                  <span className={`badge self-start ${slot.booking.unavailable ? "bg-surface text-danger" : "bg-surface text-ok"}`}>
                    {slot.booking.unavailable ? b.unavailableNow : `✓ ${b.alreadyCovered}`}
                  </span>
                  <span className="text-sm font-semibold">{slot.booking.name}</span>
                  {!slot.booking.unavailable && <span className="text-xs text-muted">{b.notified(slot.booking.name, slot.ownerName)}</span>}
                  {confirmCancel ? (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs">{b.cancelQ(slot.booking.name)}</span>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={pending} onClick={doCancel} className="btn-sm btn bg-danger text-white">{b.confirm}</button>
                        <button type="button" onClick={() => setConfirmCancel(false)} className="btn-secondary btn-sm">{b.back}</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmCancel(true)} className="btn-ghost btn-sm self-start !px-2 text-danger">{b.cancelCover}</button>
                  )}
                </div>
              )}

              {confirmFor && (
                <ConfirmBox
                  candidate={candidates.find((c) => c.id === confirmFor) ?? null}
                  name={candidates.find((c) => c.id === confirmFor)?.name ?? nameById.get(confirmFor) ?? ""}
                  prev={slot.booking && !slot.booking.unavailable ? slot.booking.name : slot.booking?.name ?? null}
                  owner={slot.ownerName}
                  pending={pending}
                  onYes={doAssign}
                  onNo={() => setConfirmFor(null)}
                />
              )}

              {slot.booking && !slot.booking.unavailable && candidates.length > 0 && !confirmFor && <h3 className="text-xs font-semibold text-muted">{b.orChange}</h3>}
              <CandidateGroups candidates={candidates} isToday={isToday} recommendFirst={!slot.booking || slot.booking.unavailable} onPick={(id) => { setConfirmFor(id); setConfirmCancel(false); }} />
              {candidates.length === 0 && (!slot.booking || slot.booking.unavailable) && <p className="text-sm text-danger">{b.noneFit}</p>}

              {slot.excluded.length > 0 && (
                <div className="flex flex-col gap-0.5 border-t border-dashed border-line-strong pt-2 text-xs text-muted">
                  <b className="text-subtle">{b.excludedTitle(slot.excluded.length)}</b>
                  {slot.excluded.map((x) => (
                    <span key={x.id}>{x.name} — {reasonText(x)}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {toast && (
        <div role="status" className={`fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 z-[60] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm shadow-pop lg:bottom-6 ${toast.ok ? "bg-ink text-surface" : "bg-danger text-white"}`}>
          {toast.message}
        </div>
      )}
    </>
  );
}

function Legend({ cls, children }: { cls: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3.5 w-3.5 rounded border ${cls}`} />
      {children}
    </span>
  );
}

function CandidateGroups({ candidates, isToday, recommendFirst, onPick }: { candidates: Candidate[]; isToday: boolean; recommendFirst: boolean; onPick: (id: string) => void }) {
  const { dict } = useLanguage();
  const b = dict.substitutes.board;
  const ready = candidates.filter((c) => !c.waiting);
  const waiting = candidates.filter((c) => c.waiting);
  const Opt = ({ c, n, top }: { c: Candidate; n: number; top: boolean }) => (
    <button
      type="button"
      onClick={() => onPick(c.id)}
      className={`grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-2.5 py-2 text-left hover:border-brand ${top ? "border-brand bg-brand-soft" : "border-line bg-surface"}`}
    >
      <span className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-full text-xs font-semibold text-white ${c.waiting ? "bg-warn" : "bg-brand"}`}>{n}</span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{c.name}</span>
        <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted">
          {c.waiting ? <span className="badge !px-1.5 !py-0 !text-[10px] bg-warn-soft text-warn">{b.waitingBadge}</span> : c.checkinAt ? <span>{c.late ? b.lateIn(c.checkinAt) : b.checkedIn(c.checkinAt)}</span> : null}
          <span>{b.loadToday(c.classesToday)}</span>
          {c.sameDept && <span>{b.sameDept}</span>}
        </span>
      </span>
      <span className={`text-xs font-semibold ${c.waiting ? "text-warn" : "text-brand-ink"}`}>{top ? b.recommended : b.choose}</span>
    </button>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {ready.length > 0 && <h3 className="text-xs font-semibold text-muted">{isToday ? b.groupReady(ready.length) : b.groupFree(ready.length)}</h3>}
      {ready.map((c, i) => <Opt key={c.id} c={c} n={i + 1} top={recommendFirst && i === 0} />)}
      {waiting.length > 0 && <h3 className="mt-1 text-xs font-semibold text-muted">{b.groupWaiting(waiting.length)}</h3>}
      {waiting.map((c, i) => <Opt key={c.id} c={c} n={ready.length + i + 1} top={false} />)}
    </div>
  );
}

function ConfirmBox({ candidate, name, prev, owner, pending, onYes, onNo }: { candidate: Candidate | null; name: string; prev: string | null; owner: string; pending: boolean; onYes: () => void; onNo: () => void }) {
  const { dict } = useLanguage();
  const b = dict.substitutes.board;
  const wait = !!candidate?.waiting;
  return (
    <div className={`flex flex-col gap-2 rounded-xl border-[1.5px] p-3 ${wait ? "border-warn bg-warn-soft" : "border-brand bg-brand-soft"}`}>
      <span className="text-sm font-semibold">{prev ? b.confirmReplace(name, prev) : b.confirmQ(name)}</span>
      {wait && <span className="text-xs text-warn">{b.waitWarn}</span>}
      <span className="text-xs text-muted">{b.willNotify([name, prev, owner].filter(Boolean).join(", "))}</span>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={onYes} className="btn-primary btn-sm">{b.confirm}</button>
        <button type="button" onClick={onNo} className="btn-secondary btn-sm">{b.back}</button>
      </div>
    </div>
  );
}
