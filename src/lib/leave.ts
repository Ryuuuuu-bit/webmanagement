import { prisma } from "@/lib/prisma";
import { LeaveType } from "@prisma/client";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { countLeaveDays, countLeaveDaysInYear, getLeaveQuotaMap, getLeaveUsedDays, LEAVE_TYPES } from "@/lib/leaveQuota";
import { notifyAdmins } from "@/lib/notify";

export const LEAVE_ATTACHMENT_MAX = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]);
const ALLOWED_EXT = /\.(pdf|jpe?g|png|webp|heic)$/i;
// Never trust the browser-supplied MIME: derive it from the extension so a
// file called cert.pdf uploaded as text/html can't be served as HTML later.
function mimeFromName(name: string): string {
  const ext = (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");
  return ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "heic" ? "image/heic" : "image/jpeg";
}

/**
 * Creates a leave request. Shared by the /api/leave/request Route Handler
 * (the browser posts multipart there — a File through a Server Action was
 * unreliable on phones) and the legacy server action. Half-day requests
 * (halfDay "AM"/"PM") are single-date and count 0.5 against the quota.
 * Over-quota is a warning, never a block.
 */
export async function createLeaveRequest(
  userId: string,
  input: { type: string; from: string; to: string; halfDay: string; reason: string; file: File | null }
): Promise<{ ok: boolean; message: string }> {
  const dict = getDictionary(getLocale());
  const type = input.type as LeaveType;
  if (!LEAVE_TYPES.includes(type)) return { ok: false, message: dict.actions.leave.invalidDates };
  const halfDay = input.halfDay === "AM" || input.halfDay === "PM" ? input.halfDay : null;
  const startDate = new Date(input.from);
  const endDate = halfDay ? new Date(input.from) : new Date(input.to);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return { ok: false, message: dict.actions.leave.invalidDates };
  if (endDate < startDate) return { ok: false, message: dict.actions.leave.endBeforeStart };

  let attachment: { attachmentName: string; attachmentMime: string; attachmentSize: number; attachmentData: Buffer } | null = null;
  if (input.file && input.file.size > 0) {
    if (input.file.size > LEAVE_ATTACHMENT_MAX) return { ok: false, message: dict.actions.leave.fileTooLarge };
    if (!ALLOWED_MIME.has(input.file.type) && !ALLOWED_EXT.test(input.file.name)) return { ok: false, message: dict.actions.leave.unsupportedType };
    attachment = {
      attachmentName: input.file.name.slice(0, 200),
      attachmentMime: ALLOWED_MIME.has(input.file.type) ? input.file.type : mimeFromName(input.file.name),
      attachmentSize: input.file.size,
      attachmentData: Buffer.from(await input.file.arrayBuffer()),
    };
  }

  const days = countLeaveDays(startDate, endDate, halfDay);
  const year = startDate.getUTCFullYear();
  const [quotaMap, usedBefore, requester, overlapping] = await Promise.all([
    getLeaveQuotaMap(),
    getLeaveUsedDays(userId, type, year),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    // Soft check only (warn, never block, matching the quota policy above) —
    // lets Admin see at a glance that two requests cover the same day(s)
    // instead of silently approving both and double-counting the overlap.
    prisma.leaveRequest.findFirst({
      where: { requesterId: userId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: endDate }, endDate: { gte: startDate } },
      select: { id: true },
    }),
  ]);
  const quota = quotaMap[type];
  const hasOverlap = !!overlapping;

  await prisma.leaveRequest.create({
    data: { requesterId: userId, type, startDate, endDate, halfDay, reason: input.reason.trim() || "-", ...(attachment ?? {}) },
  });

  // Only the portion of this request that actually falls in `year` counts
  // toward that year's quota (a request spanning New Year's has some days in
  // each year — see countLeaveDaysInYear).
  const usedAfter = usedBefore + countLeaveDaysInYear(startDate, endDate, halfDay, year);
  const overQuota = quota > 0 && usedAfter > quota;
  await notifyAdmins(
    "LEAVE_REQUESTED",
    { requesterName: requester?.name ?? "-", type, from: startDate.toISOString(), to: endDate.toISOString(), days, halfDay, overQuota, hasOverlap, hasAttachment: !!attachment },
    "/leave",
    { excludeUserId: userId }
  );

  const base = overQuota ? dict.actions.leave.submittedOverQuota(usedAfter, quota) : dict.actions.leave.submitted;
  return { ok: true, message: hasOverlap ? `${base} ${dict.actions.leave.overlapNote}` : base };
}
