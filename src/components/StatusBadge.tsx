import type { Dictionary } from "@/lib/i18n/dictionaries";

const ATTENDANCE_CLS: Record<string, string> = {
  PENDING: "bg-line-soft text-muted",
  ON_TIME: "bg-ok-soft text-ok",
  LATE: "bg-warn-soft text-warn",
  ABSENT: "bg-danger-soft text-danger",
  LEAVE: "bg-info-soft text-info",
};

const REQUEST_CLS: Record<string, string> = {
  PENDING: "bg-line-soft text-muted",
  APPROVED: "bg-ok-soft text-ok",
  REJECTED: "bg-danger-soft text-danger",
  CANCELLED: "bg-line-soft text-faint",
};

export function AttendanceBadge({ status, dict }: { status: string; dict: Dictionary }) {
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
