// Sat/Sun included so a teacher can be scheduled for extra/make-up classes
// on weekends, not just the regular Mon-Fri timetable.
export const DAY_LABELS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
export const PERIOD_LABELS = ["08:30–10:20", "10:30–12:20", "13:00–14:50", "15:00–16:50"];

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

export function formatTime(d: Date | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: BANGKOK_TZ });
}

export function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: BANGKOK_TZ });
}
