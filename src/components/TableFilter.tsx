"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "./LanguageProvider";

export type FilterSelect = { attr: string; label: string; options: { value: string; label: string }[] };

/**
 * Client-side search/filter for a server-rendered list. Works on the DOM:
 * every `<tr>` inside `<tbody>` (or any element with `data-row`) under the
 * container `#targetId` is shown/hidden by matching its text against the
 * search box, its `data-<attr>` against each select, and its `data-date`
 * (YYYY-MM-DD) against the date range. No data has to be re-fetched, so it
 * drops onto any existing table with two lines.
 */
export default function TableFilter({
  targetId,
  selects = [],
  dateRange = false,
  placeholder,
}: {
  targetId: string;
  selects?: FilterSelect[];
  dateRange?: boolean;
  placeholder?: string;
}) {
  const { dict } = useLanguage();
  const t = dict.filter;
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Record<string, string>>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [count, setCount] = useState<{ shown: number; total: number } | null>(null);

  const active = useMemo(() => q.trim() !== "" || Object.values(sel).some(Boolean) || from !== "" || to !== "", [q, sel, from, to]);

  // Re-run when the list itself changes (router.refresh after a delete /
  // create re-renders rows without touching our manual `hidden` class).
  const [tick, setTick] = useState(0);
  const selfRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.getElementById(targetId);
    if (!root) return;
    const mo = new MutationObserver((muts) => {
      // Ignore our own re-renders (the count text lives inside the same container).
      if (muts.some((m) => !selfRef.current || !selfRef.current.contains(m.target))) setTick((n) => n + 1);
    });
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [targetId]);

  useEffect(() => {
    const root = document.getElementById(targetId);
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>("tbody > tr, [data-row]"));
    const needle = q.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      let ok = true;
      const hay = (row.dataset.search ?? row.textContent ?? "").toLowerCase();
      if (needle && !hay.includes(needle)) ok = false;
      for (const [attr, value] of Object.entries(sel)) {
        if (value && row.dataset[attr] !== value) ok = false;
      }
      if (ok && (from || to)) {
        const d = row.dataset.date ?? "";
        if (from && d < from) ok = false;
        if (to && d > to) ok = false;
      }
      row.classList.toggle("hidden", !ok);
      if (ok) shown++;
    }
    setCount((c) => (c && c.shown === shown && c.total === rows.length ? c : { shown, total: rows.length }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, q, sel, from, to, tick]);

  function reset() {
    setQ("");
    setSel({});
    setFrom("");
    setTo("");
  }

  return (
    <div ref={selfRef} className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <div className="relative min-w-[180px] flex-1">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint">⌕</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder ?? t.search}
          className="input w-full py-1.5 pl-7 text-xs"
        />
      </div>
      {selects.map((s) => (
        <select
          key={s.attr}
          value={sel[s.attr] ?? ""}
          onChange={(e) => setSel({ ...sel, [s.attr]: e.target.value })}
          className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-xs text-ink"
          aria-label={s.label}
        >
          <option value="">{s.label}: {t.all}</option>
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
      {dateRange && (
        <span className="inline-flex items-center gap-1">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" aria-label={t.from} />
          <span className="text-faint">–</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" aria-label={t.to} />
        </span>
      )}
      {count && (
        <span className="text-faint">
          {active ? t.showing(count.shown, count.total) : t.total(count.total)}
        </span>
      )}
      {active && (
        <button type="button" onClick={reset} className="rounded-lg border border-line px-2 py-1 text-xs text-subtle hover:bg-line-soft">
          {t.clear}
        </button>
      )}
    </div>
  );
}
