import type { GradeLevel } from "@prisma/client";

/**
 * Helpers for the teacher-roster import (see src/actions/roster.ts) — pure,
 * so the browser preview and the server agree on what a cell means.
 */

/** Trim / collapse spaces; an ALL-CAPS name becomes Title Case ("LEA DELA CRUZ" → "Lea Dela Cruz"). */
export function cleanPersonName(raw: string): string {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!/[a-z]/.test(s) && /[A-Z]{2}/.test(s)) {
    return s.toLowerCase().replace(/(^|[\s\-'’(])([a-zà-ÿ])/g, (_, p, c) => p + c.toUpperCase());
  }
  return s;
}

const LEVEL_OF = (stage: "P" | "M", n: number): GradeLevel | null =>
  stage === "P" ? (n >= 1 && n <= 3 ? "P1_3" : n >= 4 && n <= 6 ? "P4_6" : null) : n >= 1 && n <= 3 ? "M1_3" : n >= 4 && n <= 6 ? "M4_6" : null;

/**
 * "Class teaching level" → the system's grade bands. Understands
 * Pre Kindergarten / Kindergarten / KG / K1–K3 / อนุบาล / อ.1, P.1–P.6 / ป.1,
 * M.1–M.6 / ม.1, Grade 1–12, lists ("P.4, P.5, P.6") and ranges ("P.1-P.3", "M.1–6").
 */
export function parseGradeLevels(text: string): GradeLevel[] {
  const out = new Set<GradeLevel>();
  const src = String(text ?? "").toLowerCase();
  if (/kinder|\bkg\b|\bk\s*\.?\s*[1-3]\b|อนุบาล|อ\s*\.\s*[1-3]|nursery|pre-?k/.test(src)) out.add("KG");
  const stageOf = (c: string): "P" | "M" | null => (c === "p" || c === "ป" ? "P" : c === "m" || c === "ม" ? "M" : null);
  // ranges first: P.1-P.3 / P1-3 / ม.1–ม.3
  const ranges = /([pmปม])\s*\.?\s*([1-6])\s*[-–—~]\s*(?:([pmปม])\s*\.?\s*)?([1-6])/g;
  let rest = src;
  for (const m of Array.from(src.matchAll(ranges))) {
    const a = stageOf(m[1]);
    const b = m[3] ? stageOf(m[3]) : a;
    if (!a || a !== b) continue;
    for (let n = Math.min(+m[2], +m[4]); n <= Math.max(+m[2], +m[4]); n++) {
      const lv = LEVEL_OF(a, n);
      if (lv) out.add(lv);
    }
    rest = rest.replace(m[0], " ");
  }
  for (const m of Array.from(rest.matchAll(/(?:^|[^a-zก-๙])([pmปม])\s*\.?\s*([1-6])(?![0-9])/g))) {
    const st = stageOf(m[1]);
    const lv = st ? LEVEL_OF(st, +m[2]) : null;
    if (lv) out.add(lv);
  }
  // "Grade 1-6" / "grade 7–12": every grade in the range.
  for (const m of Array.from(rest.matchAll(/grade\s*(\d{1,2})\s*[-–—~]\s*(\d{1,2})/g))) {
    for (let n = Math.min(+m[1], +m[2]); n <= Math.max(+m[1], +m[2]) && n <= 12; n++) {
      const lv = n <= 6 ? LEVEL_OF("P", n) : LEVEL_OF("M", n - 6);
      if (lv) out.add(lv);
    }
    rest = rest.replace(m[0], " ");
  }
  for (const m of Array.from(rest.matchAll(/grade\s*(\d{1,2})/g))) {
    const n = +m[1];
    const lv = n <= 6 ? LEVEL_OF("P", n) : LEVEL_OF("M", n - 6);
    if (lv) out.add(lv);
  }
  const order: GradeLevel[] = ["KG", "P1_3", "P4_6", "M1_3", "M4_6"];
  return order.filter((x) => out.has(x));
}

/** Roster columns the import understands, with the header spellings recognised automatically. */
export type RosterField =
  | "name" | "email" | "username" | "thaiName" | "nickname" | "nationality" | "phone" | "startDate" | "classLevels" | "subjects" | "project"
  | "ppNo" | "ppIssue" | "ppExp" | "wpNo" | "wpIssue" | "wpExp" | "tlNo" | "tlIssue" | "tlExp";

export const ROSTER_FIELDS: RosterField[] = [
  "name", "email", "username", "thaiName", "nickname", "nationality", "phone", "startDate", "classLevels", "subjects", "project",
  "ppNo", "ppIssue", "ppExp", "wpNo", "wpIssue", "wpExp", "tlNo", "tlIssue", "tlExp",
];

/** Header aliases (lower-case, spaces collapsed). Covers the client's sheet (both header rows) plus common Thai headers. */
export const ROSTER_GUESS: Record<RosterField, string[]> = {
  name: ["name", "full name", "name (first + middle + last name)", "ชื่อ", "ชื่อ-นามสกุล", "ชื่อ-สกุล", "teacher", "teacher name"],
  email: ["email", "e-mail", "e-mail address", "email address", "อีเมล"],
  username: ["username", "user name", "ชื่อผู้ใช้"],
  thaiName: ["tname", "thai name", "ชื่อภาษาไทย", "ชื่อไทย"],
  nickname: ["nname", "nickname", "nick name", "ชื่อเล่น"],
  nationality: ["nation", "nationality", "สัญชาติ"],
  phone: ["phone", "phone number", "tel", "mobile", "เบอร์โทร", "โทรศัพท์", "เบอร์โทรศัพท์"],
  startDate: ["start", "start date", "start working date", "วันเริ่มงาน", "วันที่เริ่มงาน"],
  classLevels: ["classtech", "class teaching level", "class level", "grade level", "ระดับชั้น", "ระดับชั้นที่สอน"],
  subjects: ["subj", "subject", "subjects", "subjects teaching", "วิชา", "วิชาที่สอน"],
  project: ["project", "โครงการ"],
  ppNo: ["ppno", "passport no.", "passport no", "passport number", "เลขพาสปอร์ต", "เลขหนังสือเดินทาง"],
  ppIssue: ["ppissue", "passport_issue", "passport issue", "passport issue date", "passport issued"],
  ppExp: ["ppexp", "passport_exp", "passport exp", "passport expiry", "passport expiry date", "วันหมดอายุพาสปอร์ต"],
  wpNo: ["wpno", "work permit no.", "work permit no", "work permit number", "เลขใบอนุญาตทำงาน"],
  wpIssue: ["wpissue", "work permit issue", "work permit issue date"],
  wpExp: ["wpexp", "work permit exp", "work permit expiry", "work permit expiry date", "วันหมดอายุใบอนุญาตทำงาน"],
  tlNo: ["tlno", "teacherlicense no", "teacher license no", "teaching license no", "เลขใบประกอบวิชาชีพ"],
  tlIssue: ["tlissue", "teacherlicense issue", "teacher license issue"],
  tlExp: ["tlexp", "teacherlicense exp", "teacher license exp", "teacher license expiry", "teaching license expiry", "วันหมดอายุใบประกอบวิชาชีพ"],
};

export const normHeader = (h: string) => String(h ?? "").toLowerCase().replace(/\s+/g, " ").trim();
