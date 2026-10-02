import { prisma } from "./prisma";
import type { DocStatusValue as DocStatus } from "./docStatus";
import { bangkokDateKey, daysBetweenKeys, pickedDateKey } from "./date";

/**
 * Personnel documents (work permit, visa, passport, …) with expiry
 * reminders. Types are Admin-defined; these are created the first time the
 * page opens so the client starts with the usual set for foreign teachers.
 */
export const DEFAULT_DOCUMENT_TYPES: { name: string; remindDays: string }[] = [
  { name: "Work Permit", remindDays: "90,60" },
  { name: "Visa", remindDays: "90,60" },
  { name: "Passport", remindDays: "180,90" },
  { name: "90-Day Report (ตม.47)", remindDays: "14,7" },
  { name: "ใบอนุญาตประกอบวิชาชีพครู", remindDays: "90,60" },
];

export async function ensureDefaultDocumentTypes() {
  if ((await prisma.documentType.count()) > 0) return;
  await prisma.documentType.createMany({
    data: DEFAULT_DOCUMENT_TYPES.map((t, i) => ({ ...t, sortOrder: i })),
    skipDuplicates: true,
  });
}

/** "90, 60,abc" → [90, 60] (unique, descending, 1..730). */
export function parseRemindDays(s: string | null | undefined): number[] {
  const nums = (s ?? "").split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 730);
  return Array.from(new Set(nums)).sort((a, b) => b - a);
}


/** Days left until the expiry date (negative once expired), on the Bangkok calendar. */
export function daysLeft(expiry: Date, now = new Date()) {
  return daysBetweenKeys(bangkokDateKey(now), pickedDateKey(expiry));
}

export function docStatus(expiry: Date | null, remindDays: number[], now = new Date()): DocStatus {
  if (!expiry) return "NO_EXPIRY";
  const left = daysLeft(expiry, now);
  if (left < 0) return "EXPIRED";
  if (left <= (remindDays[0] ?? 90)) return "EXPIRING";
  return "VALID";
}

export const DOC_ATTACHMENT_MAX = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]);
const EXT_MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

/** Allowed attachment MIME derived from the file name (browser-supplied type not trusted), or null. */
export function attachmentMime(name: string, declared: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const byExt = EXT_MIME[ext];
  if (byExt) return byExt;
  return ALLOWED_MIME.has(declared) ? declared : null;
}
