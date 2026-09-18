export const DAY_LABELS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์"];
export const PERIOD_LABELS = ["08:30–10:20", "10:30–12:20", "13:00–14:50", "15:00–16:50"];

/** Maps JS getDay() (0=Sun..6=Sat) to our 0=Mon..4=Fri scale. Returns -1 on weekends. */
export function toWeekdayIndex(date: Date) {
  const js = date.getDay();
  const map = [-1, 0, 1, 2, 3, 4, -1];
  return map[js];
}

export function todayAtMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatTime(d: Date | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}
