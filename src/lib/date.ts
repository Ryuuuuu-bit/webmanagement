import type { Dictionary, Locale } from "./i18n/dictionaries";

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

function intlLocale(locale: Locale) {
  return locale === "en" ? "en-US" : "th-TH";
}

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

/** English renders as 12-hour with AM/PM (the natural convention); Thai stays 24-hour, as before. */
export function formatTime(d: Date | null | undefined, locale: Locale = "th") {
  if (!d) return null;
  return new Date(d).toLocaleTimeString(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: locale === "en",
    timeZone: BANGKOK_TZ,
  });
}

/** th-TH renders the Buddhist Era year (e.g. 2569) automatically — intentional and expected for Thai users; en-US renders the Gregorian year. */
export function formatDate(d: Date | string, locale: Locale = "th") {
  return new Date(d).toLocaleDateString(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: BANGKOK_TZ,
  });
}

/**
 * Label for a recurring weekly day + time (schedule slots repeat by
 * day-of-week, not a specific calendar date) — e.g. "วันอาทิตย์ 14:00 น."
 * or "Sunday 14:00–15:00" in English.
 */
export function formatDayTime(dict: Dictionary, locale: Locale, dayOfWeek: number, startTime: string, endTime?: string) {
  const time = endTime ? `${startTime}–${endTime}` : startTime;
  const suffix = locale === "th" ? " น." : "";
  return `${dict.day.full[dayOfWeek]} ${time}${suffix}`;
}

/** "HH:MM น." in Thai; plain "HH:MM" in English. */
export function formatTimeLabel(t: string, locale: Locale = "th") {
  return locale === "th" ? `${t} น.` : t;
}
