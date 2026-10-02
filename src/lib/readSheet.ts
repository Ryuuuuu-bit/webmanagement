"use client";

import type { WorkBook } from "xlsx";

/**
 * Opens an uploaded spreadsheet in the browser with SheetJS.
 *
 * .xlsx/.xls are binary and carry their own encoding. Text files (.csv) do
 * not — and Excel on a Thai Windows PC saves "CSV (Comma delimited)" in the
 * ANSI code page (Windows-874 / TIS-620), which SheetJS would read as Latin-1
 * and garble every Thai name. So text is decoded here first: UTF-16 when it
 * has that BOM ("Unicode Text"), UTF-8 when it is valid UTF-8 (incl. "CSV
 * UTF-8" and Google Sheets downloads), otherwise Windows-874.
 *
 * raw:true keeps CSV cells as typed — "14/01/2570" stays text instead of
 * being re-read month-first (src/lib/parseDateCell.ts handles dates).
 */
export async function readWorkbook(file: File): Promise<WorkBook> {
  const XLSX = await import("xlsx");
  const buf = new Uint8Array(await file.arrayBuffer());
  const zip = buf[0] === 0x50 && buf[1] === 0x4b; // .xlsx (PK)
  const ole = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0; // legacy .xls
  if (zip || ole) return XLSX.read(buf, { type: "array", raw: true });
  return XLSX.read(decodeText(buf), { type: "string", raw: true });
}

export function decodeText(buf: Uint8Array): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-874").decode(buf);
  }
}
