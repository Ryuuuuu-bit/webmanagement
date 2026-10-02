"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { DATE_KEY_RE, keyToDate } from "@/lib/calendar";
import { parseRemindDays } from "@/lib/documents";
import { logAudit } from "@/lib/audit";

type ActionResult = { ok: boolean; message: string };

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

const str = (fd: FormData, k: string, max = 200) => ((fd.get(k) as string) || "").trim().slice(0, max);

// --- document types ---------------------------------------------------------

function parseTypeInput(fd: FormData) {
  return {
    name: str(fd, "name", 100),
    remindDays: parseRemindDays(str(fd, "remindDays")).join(",") || "90,60",
    notifyTeacher: fd.get("notifyTeacher") === "on",
  };
}

export async function createDocumentType(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const t = getDictionary(getLocale()).actions.documents;
  const input = parseTypeInput(fd);
  if (!input.name) return { ok: false, message: t.fillRequired };
  if (await prisma.documentType.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } })) return { ok: false, message: t.typeExists };
  const last = await prisma.documentType.aggregate({ _max: { sortOrder: true } });
  await prisma.documentType.create({ data: { ...input, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
  revalidatePath("/documents");
  return { ok: true, message: t.typeSaved(input.name) };
}

export async function updateDocumentType(id: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const t = getDictionary(getLocale()).actions.documents;
  const input = parseTypeInput(fd);
  if (!input.name) return { ok: false, message: t.fillRequired };
  if (await prisma.documentType.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, NOT: { id } } })) return { ok: false, message: t.typeExists };
  const res = await prisma.documentType.updateMany({ where: { id }, data: input });
  if (res.count === 0) return { ok: false, message: t.notFound };
  revalidatePath("/documents");
  return { ok: true, message: t.typeSaved(input.name) };
}

/** Blocked while any teacher still has a document of this type. */
export async function deleteDocumentType(id: string): Promise<ActionResult> {
  await requireAdmin();
  const t = getDictionary(getLocale()).actions.documents;
  const type = await prisma.documentType.findUnique({ where: { id }, include: { _count: { select: { documents: true } } } });
  if (!type) return { ok: false, message: t.notFound };
  if (type._count.documents > 0) return { ok: false, message: t.typeInUse(type._count.documents) };
  await prisma.documentType.delete({ where: { id } });
  revalidatePath("/documents");
  return { ok: true, message: t.typeDeleted(type.name) };
}

// --- documents --------------------------------------------------------------

function optDate(v: string): Date | null | "invalid" {
  if (!v) return null;
  return DATE_KEY_RE.test(v) && !isNaN(keyToDate(v).getTime()) ? keyToDate(v) : "invalid";
}

/**
 * Create (id = null) or edit one teacher's document — one per teacher + type.
 * Returns the row id so the client can upload the scan right after.
 */
export async function saveDocument(id: string | null, fd: FormData): Promise<ActionResult & { id?: string }> {
  const session = await requireAdmin();
  const t = getDictionary(getLocale()).actions.documents;
  const userId = str(fd, "userId");
  const typeId = str(fd, "typeId");
  const issueDate = optDate(str(fd, "issueDate"));
  const expiryDate = optDate(str(fd, "expiryDate"));
  if (!userId || !typeId) return { ok: false, message: t.fillRequired };
  if (issueDate === "invalid" || expiryDate === "invalid") return { ok: false, message: t.invalidDate };
  const data = { userId, typeId, number: str(fd, "number", 100) || null, note: str(fd, "note", 1000) || null, issueDate, expiryDate };

  const [dup, user, type] = await Promise.all([
    prisma.teacherDocument.findUnique({ where: { userId_typeId: { userId, typeId } }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.documentType.findUnique({ where: { id: typeId }, select: { name: true } }),
  ]);
  if (dup && dup.id !== id) return { ok: false, message: t.duplicate };
  if (!user || !type) return { ok: false, message: t.notFound };
  if (id && !(await prisma.teacherDocument.findUnique({ where: { id }, select: { id: true } }))) return { ok: false, message: t.notFound };

  const row = id ? await prisma.teacherDocument.update({ where: { id }, data }) : await prisma.teacherDocument.create({ data });
  await logAudit({
    action: "DOCUMENT_CHANGED",
    actorId: session.user.id,
    targetUserId: userId,
    detail: `${id ? "edit" : "add"} ${type.name}${expiryDate ? ` exp ${expiryDate.toISOString().slice(0, 10)}` : ""}`,
  });
  revalidatePath("/documents");
  return { ok: true, message: t.saved(user.name, type.name), id: row.id };
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  const session = await requireAdmin();
  const t = getDictionary(getLocale()).actions.documents;
  const row = await prisma.teacherDocument.findUnique({ where: { id }, select: { userId: true, type: { select: { name: true } } } });
  if (!row) return { ok: false, message: t.notFound };
  await prisma.teacherDocument.delete({ where: { id } });
  await logAudit({ action: "DOCUMENT_CHANGED", actorId: session.user.id, targetUserId: row.userId, detail: `delete ${row.type.name}` });
  revalidatePath("/documents");
  return { ok: true, message: t.deleted };
}

export async function removeDocumentFile(id: string): Promise<ActionResult> {
  await requireAdmin();
  const t = getDictionary(getLocale()).actions.documents;
  const res = await prisma.teacherDocument.updateMany({
    where: { id },
    data: { attachmentName: null, attachmentMime: null, attachmentSize: null, attachmentData: null },
  });
  if (res.count === 0) return { ok: false, message: t.notFound };
  revalidatePath("/documents");
  return { ok: true, message: t.fileRemoved };
}

// --- import -----------------------------------------------------------------

/** One spreadsheet row after the client mapped its columns (dates already "YYYY-MM-DD" or ""). */
export type ImportDocumentRow = { row: number; teacher: string; type: string; number: string; issueDate: string; expiryDate: string; note: string };
export type ImportDocumentResult = { row: number; teacher: string; type: string; ok: boolean; message: string };

/**
 * Bulk upsert from an .xlsx/.csv (or a Google Sheet downloaded as either).
 * Teacher is matched by username, email or exact name; an unknown document
 * type is created on the fly. Empty cells leave the stored value alone, so a
 * sheet with only the expiry column can be re-imported to record renewals.
 */
export async function importDocuments(rows: ImportDocumentRow[]): Promise<{ ok: boolean; message: string; results: ImportDocumentResult[] }> {
  const session = await requireAdmin();
  const t = getDictionary(getLocale()).actions.documents;
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, message: t.importEmpty, results: [] };
  if (rows.length > 2000) return { ok: false, message: t.importTooMany, results: [] };

  const [users, types] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, username: true, email: true } }),
    prisma.documentType.findMany({ select: { id: true, name: true, sortOrder: true } }),
  ]);
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  // key → user id, or null when two people share the key (refuse to guess).
  const userKey = new Map<string, string | null>();
  for (const u of users) {
    for (const k of [u.username, u.email, u.name]) {
      if (!k) continue;
      const key = norm(k);
      userKey.set(key, userKey.has(key) && userKey.get(key) !== u.id ? null : u.id);
    }
  }
  const typeKey = new Map(types.map((x) => [norm(x.name), x.id]));
  let maxOrder = types.reduce((m, x) => Math.max(m, x.sortOrder), 0);

  const results: ImportDocumentResult[] = [];
  let okCount = 0;
  for (const r of rows) {
    const base = { row: Number(r.row) || 0, teacher: String(r.teacher ?? "").trim(), type: String(r.type ?? "").trim().slice(0, 100) || "Work Permit" };
    const userId = userKey.get(norm(base.teacher));
    if (!base.teacher || userId === undefined) {
      results.push({ ...base, ok: false, message: t.importNoTeacher });
      continue;
    }
    if (userId === null) {
      results.push({ ...base, ok: false, message: t.importAmbiguous });
      continue;
    }
    const issue = optDate(String(r.issueDate ?? "").trim());
    const expiry = optDate(String(r.expiryDate ?? "").trim());
    if (issue === "invalid" || expiry === "invalid") {
      results.push({ ...base, ok: false, message: t.invalidDate });
      continue;
    }
    let typeId = typeKey.get(norm(base.type));
    if (!typeId) {
      typeId = (await prisma.documentType.create({ data: { name: base.type, sortOrder: ++maxOrder } })).id;
      typeKey.set(norm(base.type), typeId);
    }
    const number = String(r.number ?? "").trim().slice(0, 100);
    const note = String(r.note ?? "").trim().slice(0, 1000);
    const patch = {
      ...(number ? { number } : {}),
      ...(note ? { note } : {}),
      ...(issue ? { issueDate: issue } : {}),
      ...(expiry ? { expiryDate: expiry } : {}),
    };
    const existing = await prisma.teacherDocument.findUnique({ where: { userId_typeId: { userId, typeId } }, select: { id: true } });
    if (existing) await prisma.teacherDocument.update({ where: { id: existing.id }, data: patch });
    else await prisma.teacherDocument.create({ data: { userId, typeId, ...patch } });
    results.push({ ...base, ok: true, message: existing ? t.importUpdated : t.importCreated });
    okCount++;
  }

  await logAudit({ action: "DOCUMENT_CHANGED", actorId: session.user.id, detail: `import ${okCount}/${rows.length} rows` });
  revalidatePath("/documents");
  return { ok: okCount > 0, message: t.importDone(okCount, results.length - okCount), results };
}
