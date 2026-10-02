import type { Dictionary } from "@/lib/i18n/dictionaries";

const ATTENDANCE_CLS: Record<string, string> = {
  PENDING: "bg-line-soft text-muted",
  AWAITING_ATTEST: "bg-warn-soft text-warn",
  ON_TIME: "bg-ok-soft text-ok",
  LATE: "bg-warn-soft text-warn",
  ABSENT: "bg-danger-soft text-danger",
  LEAVE: "bg-info-soft text-info",
  HOLIDAY: "bg-line-soft text-faint",
};

const REQUEST_CLS: Record<string, string> = {
  PENDING: "bg-line-soft text-muted",
  APPROVED: "bg-ok-soft text-ok",
  REJECTED: "bg-danger-soft text-danger",
  CANCELLED: "bg-line-soft text-faint",
};

type AttendanceTimes = { checkinAt?: Date | string | null; checkoutAt?: Date | string | null } | null | undefined;

/**
 * Display-only status: a day that was checked OUT but never checked in
 * (forgot) is still PENDING in the database until a check-in attestation is
 * approved, but showing it as "not checked in" would be wrong — it's
 * "awaiting check-in attestation". Use this for badges, filters and counts.
 * `dayOff` (weekend / ปฏิทินโรงเรียน holiday at their school): a day with no
 * record shows as "HOLIDAY" instead of "not checked in yet".
 */
export function attendanceDisplayStatus(status: string, row?: AttendanceTimes, dayOff = false) {
  if (status === "PENDING" && row && !row.checkinAt && row.checkoutAt) return "AWAITING_ATTEST";
  if (status === "PENDING" && dayOff && !row?.checkinAt && !row?.checkoutAt) return "HOLIDAY";
  return status;
}

export function AttendanceBadge({ status: rawStatus, row, dict, dayOff = false }: { status: string; row?: AttendanceTimes; dict: Dictionary; dayOff?: boolean }) {
  const status = attendanceDisplayStatus(rawStatus, row, dayOff);
  const key = (status as keyof typeof dict.status.attendance) ?? "PENDING";
  const label = dict.status.attendance[key] ?? dict.status.attendance.PENDING;
  const cls = ATTENDANCE_CLS[status] ?? ATTENDANCE_CLS.PENDING;
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function RequestBadge({ status, dict }: { status: string; dict: Dictionary }) {
  const key = (status as keyof typeof dict.status.request) ?? "PENDING";
  const label = dict.status.request[key] ?? dict.status.request.PENDING;
  const cls = REQUEST_CLS[status] ?? REQUEST_CLS.PENDING;
  return <span className={`badge ${cls}`}>{label}</span>;
}
