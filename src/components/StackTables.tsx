"use client";

import { useEffect } from "react";

/**
 * Fills `data-label` on every cell of a `table.table-stack` from its column
 * header, so the phone layout in globals.css can print the header next to
 * each value. Re-runs when the DOM changes (filters, router.refresh).
 * Cells under an empty header (action columns) get no label; cells with
 * nothing but "—" are marked data-blank (hidden on phones).
 */
export default function StackTables() {
  useEffect(() => {
    let raf = 0;
    const label = () => {
      raf = 0;
      document.querySelectorAll<HTMLTableElement>("table.table-stack").forEach((table) => {
        const heads = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th")).map((th) => th.textContent?.trim() ?? "");
        if (heads.length === 0) return;
        table.querySelectorAll<HTMLTableRowElement>("tbody > tr").forEach((tr) => {
          Array.from(tr.cells).forEach((td, i) => {
            const h = heads[i];
            if (h && td.dataset.label !== h) td.dataset.label = h;
            else if (!h && td.dataset.label) delete td.dataset.label;
            // A cell that only says "—" is hidden in the phone card layout.
            const blank = /^[—–-]?$/.test(td.textContent?.trim() ?? "") && !td.querySelector("button, a, input, select, img");
            if (blank && td.dataset.blank !== "1") td.dataset.blank = "1";
            else if (!blank && td.dataset.blank) delete td.dataset.blank;
          });
        });
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(label);
    };
    label();
    const mo = new MutationObserver((muts) => {
      // data-label writes are our own; only react to structural changes.
      if (muts.some((m) => m.type === "childList")) schedule();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
