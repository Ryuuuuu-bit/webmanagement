// Sat/Sun included so a teacher can be scheduled for extra/make-up classes
// on weekends, not just the regular Mon-Fri timetable.
export const DAY_LABELS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];

/** Maps JS getDay() (0=Sun..6=Sat) to our 0=Mon..6=Sun scale used throughout the app. */
export function toWeekdayIndex(date: Date) {
  const js = date.getDay();
  const map = [6, 0, 1, 2, 3, 4, 5];
  return map[js];
}

// All wall-clock computation in this app is meant to happen in Thailand
// local time (UTC+7), regardless of what timezone the server process itself
// runs in (Railway defaults containers to UTC). The TZ=Asia/Bangkok env var
// set on the Railway service makes setHours/getHours/getDay etc. behave
// correctly already; the explicit `timeZone` below is a belt-and-suspenders
// guard for display formatting so it's correct even if that env var is ever
// missing (e.g. a fresh environment).
const BANGKOK_TZ = "Asia/Bangkok";

export function todayAtMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Mon..Sun dates of the current week (server-local calendar, i.e. Bangkok time). Cosmetic only — the weekly timetable itself just repeats by dayOfWeek, not by specific date. */
export function getCurrentWeekDates(): Date[] {
  const now = new Date();
  const idx = toWeekdayIndex(now);
  const monday = new Date(now);
  monday.setDate(now.getDate() - idx);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

export function formatTime(d: Date | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: BANGKOK_TZ });
}

export function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: BANGKOK_TZ });
}
