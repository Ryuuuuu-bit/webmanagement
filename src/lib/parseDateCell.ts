/**
 * Turns a spreadsheet date cell into "YYYY-MM-DD" (or "" when empty).
 * Thai schools keep dates in many shapes, so this accepts:
 *   - real date cells (SheetJS Date with cellDates, or an Excel serial number)
 *   - 2026-12-31 / 31/12/2026 / 31-12-2569 / 31.12.69 (day-first; B.E. years converted)
 *   - 31 ธ.ค. 2569 / 31 ธันวาคม 2569 / 31 Dec 2026 / Dec 31, 2026
 * Anything else is returned unchanged so the server reports it as invalid.
 */
const TH_MONTHS = [
  ["ม.ค.", "มกราคม"], ["ก.พ.", "กุมภาพันธ์"], ["มี.ค.", "มีนาคม"], ["เม.ย.", "เมษายน"], ["พ.ค.", "พฤษภาคม"], ["มิ.ย.", "มิถุนายน"],
  ["ก.ค.", "กรกฎาคม"], ["ส.ค.", "สิงหาคม"], ["ก.ย.", "กันยายน"], ["ต.ค.", "ตุลาคม"], ["พ.ย.", "พฤศจิกายน"], ["ธ.ค.", "ธันวาคม"],
];
const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function normYear(y: number) {
  if (y < 100) y = y >= 50 ? 2500 + y : 2000 + y; // "69" → 2569 (B.E.), "26" → 2026
  if (y > 2400) y -= 543; // Buddhist Era → Gregorian
  return y;
}

function key(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function monthFromName(s: string): number | null {
  const v = s.trim().toLowerCase().replace(/\s+/g, "");
  for (let i = 0; i < 12; i++) {
    const [abbr, full] = TH_MONTHS[i];
    if (v === abbr.replace(/\s+/g, "") || v === abbr.replace(/\./g, "") || v === full) return i + 1;
  }
  const en = EN_MONTHS.findIndex((m) => v.startsWith(m));
  return en >= 0 ? en + 1 : null;
}

export function parseDateCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date && !isNaN(v.getTime())) {
    return key(normYear(v.getFullYear()), v.getMonth() + 1, v.getDate()) ?? "";
  }
  if (typeof v === "number" && v > 0 && v < 200000) {
    // Excel serial (days since 1899-12-30). Drop the time part, tolerating the
    // few-seconds drift some writers add (46400.99995 is still the 14th).
    const d = new Date((Math.floor(v + 0.001) - 25569) * 86_400_000);
    return key(normYear(d.getUTCFullYear()), d.getUTCMonth() + 1, d.getUTCDate()) ?? String(v);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return key(normYear(+m[1]), +m[2], +m[3]) ?? s;
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) return key(normYear(+m[3]), +m[2], +m[1]) ?? s;
  m = s.match(/^(\d{1,2})\s*([^\d\s,]+(?:\s?[^\d\s,]+)?)\s*,?\s*(\d{2,4})$/);
  if (m) {
    const month = monthFromName(m[2]);
    if (month) return key(normYear(+m[3]), month, +m[1]) ?? s;
  }
  m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = monthFromName(m[1]);
    if (month) return key(normYear(+m[3]), month, +m[2]) ?? s;
  }
  return s;
}
