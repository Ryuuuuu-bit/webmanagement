const ATTENDANCE_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "ยังไม่เช็คอิน", cls: "bg-black/5 text-black/50" },
  ON_TIME: { label: "ตรงเวลา", cls: "bg-ok-soft text-ok" },
  LATE: { label: "มาสาย", cls: "bg-warn-soft text-warn" },
  ABSENT: { label: "ขาด", cls: "bg-danger-soft text-danger" },
  LEAVE: { label: "ลา", cls: "bg-info-soft text-info" },
};

const REQUEST_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "รออนุมัติ", cls: "bg-black/5 text-black/50" },
  APPROVED: { label: "อนุมัติแล้ว", cls: "bg-ok-soft text-ok" },
  REJECTED: { label: "ไม่อนุมัติ", cls: "bg-danger-soft text-danger" },
};

export function AttendanceBadge({ status }: { status: string }) {
  const m = ATTENDANCE_META[status] ?? ATTENDANCE_META.PENDING;
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

export function RequestBadge({ status }: { status: string }) {
  const m = REQUEST_META[status] ?? REQUEST_META.PENDING;
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}
