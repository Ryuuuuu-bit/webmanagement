import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { notifyAdmins } from "@/lib/notify";
import { describeDevice } from "@/lib/device";

/**
 * "รายงานปัญหา" — feedback about the web app itself. Shared by the
 * /api/feedback/report Route Handler (raw upload, see uploadClient.ts) and
 * the admin actions in src/actions/feedback.ts.
 */

export const ISSUE_CATEGORIES = ["BUG", "SUGGESTION", "QUESTION", "OTHER"] as const;
export type IssueCategoryValue = (typeof ISSUE_CATEGORIES)[number];
export const ISSUE_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type IssueStatusValue = (typeof ISSUE_STATUSES)[number];
/** Menu/feature keys a report can point at — mirrors dictionary feedback.areas. */
export const ISSUE_AREAS = ["dashboard", "schedule", "checkin", "leave", "attest", "lessonPlans", "notifications", "account", "admin", "other"] as const;
export type IssueAreaValue = (typeof ISSUE_AREAS)[number];

export const ISSUE_ATTACHMENT_MAX = 5 * 1024 * 1024; // 5 MB screenshot / PDF
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);
const ALLOWED_EXT = /\.(jpe?g|png|webp|heic|pdf)$/i;
function mimeFromName(name: string): string {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "heic" ? "image/heic" : "image/jpeg";
}

const TITLE_MAX = 120;
const DETAIL_MAX = 4000;

export async function createIssueReport(
  userId: string,
  input: { category: string; area: string; title: string; detail: string; pageUrl: string; file: File | null }
): Promise<{ ok: boolean; message: string }> {
  const dict = getDictionary(getLocale());
  const t = dict.actions.feedback;
  const category = (ISSUE_CATEGORIES as readonly string[]).includes(input.category) ? (input.category as IssueCategoryValue) : "OTHER";
  const area = (ISSUE_AREAS as readonly string[]).includes(input.area) ? (input.area as IssueAreaValue) : "other";
  const title = input.title.trim().slice(0, TITLE_MAX);
  const detail = input.detail.trim().slice(0, DETAIL_MAX);
  if (!title) return { ok: false, message: t.titleRequired };
  if (!detail) return { ok: false, message: t.detailRequired };

  let attachment: { attachmentName: string; attachmentMime: string; attachmentSize: number; attachmentData: Buffer } | null = null;
  if (input.file && input.file.size > 0) {
    if (input.file.size > ISSUE_ATTACHMENT_MAX) return { ok: false, message: t.fileTooLarge };
    if (!ALLOWED_MIME.has(input.file.type) && !ALLOWED_EXT.test(input.file.name)) return { ok: false, message: t.unsupportedType };
    attachment = {
      attachmentName: input.file.name.slice(0, 200),
      attachmentMime: ALLOWED_MIME.has(input.file.type) ? input.file.type : mimeFromName(input.file.name),
      attachmentSize: input.file.size,
      attachmentData: Buffer.from(await input.file.arrayBuffer()),
    };
  }

  // Only keep same-origin paths — never store an arbitrary URL a client sent.
  const pageUrl = /^\/[A-Za-z0-9\-._~/?&=%]*$/.test(input.pageUrl) ? input.pageUrl.slice(0, 300) : null;

  const [row, reporter] = await Promise.all([
    prisma.issueReport.create({
      data: { reporterId: userId, category, area, title, detail, pageUrl, device: describeDevice(), ...(attachment ?? {}) },
      select: { id: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  await notifyAdmins(
    "ISSUE_REPORTED",
    { reporterName: reporter?.name ?? "-", category, area, title, hasAttachment: !!attachment },
    `/feedback#issue-${row.id}`,
    { excludeUserId: userId }
  );
  return { ok: true, message: t.submitted };
}
