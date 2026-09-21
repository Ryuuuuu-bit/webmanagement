"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { notifyUser } from "@/lib/notify";
import { ISSUE_STATUSES, type IssueStatusValue } from "@/lib/feedback";

type Result = { ok: boolean; message: string };

/**
 * Admin triage of an issue report: change its status and/or leave a reply.
 * The reporter is notified whenever either changed (not for a no-op save).
 */
export async function updateIssue(id: string, input: { status: string; adminNote: string }): Promise<Result> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  const t = dict.actions.feedback;
  if (!session?.user || session.user.role !== "ADMIN") return { ok: false, message: dict.actions.unauthorized };
  if (!(ISSUE_STATUSES as readonly string[]).includes(input.status)) return { ok: false, message: t.invalidStatus };
  const status = input.status as IssueStatusValue;
  const adminNote = input.adminNote.trim().slice(0, 2000);

  const row = await prisma.issueReport.findUnique({ where: { id }, select: { reporterId: true, status: true, adminNote: true, title: true } });
  if (!row) return { ok: false, message: t.notFound };
  const statusChanged = row.status !== status;
  const noteChanged = (row.adminNote ?? "") !== adminNote;
  if (!statusChanged && !noteChanged) return { ok: true, message: t.unchanged };

  await prisma.issueReport.update({
    where: { id },
    data: { status, adminNote: adminNote || null, handlerId: session.user.id },
  });
  const handler = await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } });
  if (row.reporterId !== session.user.id) {
    await notifyUser(
      row.reporterId,
      "ISSUE_UPDATED",
      { title: row.title, status, handlerName: handler?.name ?? "-", hasNote: !!adminNote, note: adminNote.slice(0, 140) },
      `/feedback#issue-${id}`
    );
  }
  revalidatePath("/feedback");
  return { ok: true, message: t.updated };
}

/** Admin removes a report for good (spam, test entries). */
export async function deleteIssue(id: string): Promise<Result> {
  const session = await getServerSession(authOptions);
  const dict = getDictionary(getLocale());
  if (!session?.user || session.user.role !== "ADMIN") return { ok: false, message: dict.actions.unauthorized };
  const res = await prisma.issueReport.deleteMany({ where: { id } });
  revalidatePath("/feedback");
  return res.count > 0 ? { ok: true, message: dict.actions.feedback.deleted } : { ok: false, message: dict.actions.feedback.notFound };
}
