import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import DocumentsManager, { type DocumentRow } from "@/components/DocumentsManager";
import { DOC_STATUS_TONE, fileKind } from "@/lib/docStatus";
import DocumentImport from "@/components/DocumentImport";
import DocumentTypeManagement from "@/components/DocumentTypeManagement";
import {
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
  saveDocument,
  deleteDocument,
  removeDocumentFile,
  importDocuments,
} from "@/actions/documents";
import { daysLeft, docStatus, ensureDefaultDocumentTypes, parseRemindDays } from "@/lib/documents";
import { formatDate, pickedDateKey } from "@/lib/date";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

const STATUS_ORDER = { EXPIRED: 0, EXPIRING: 1, VALID: 2, NO_EXPIRY: 3 } as const;

/**
 * "เอกสารครู": work permits, visas, passports, … with expiry tracking.
 * Admin manages everything; a teacher sees their own documents read-only.
 */
export default async function DocumentsPage() {
  const session = await requireUser();
  const isAdmin = session.user.role === "ADMIN";
  const locale = getLocale();
  const dict = getDictionary(locale);
  const t = dict.documents;

  if (isAdmin) await ensureDefaultDocumentTypes();
  const [types, docs] = await Promise.all([
    prisma.documentType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { documents: true } } } }),
    prisma.teacherDocument.findMany({
      where: isAdmin ? {} : { userId: session.user.id },
      select: {
        id: true, userId: true, typeId: true, number: true, issueDate: true, expiryDate: true, note: true, attachmentName: true,
        user: { select: { name: true, campusLocationId: true, campusLocation: { select: { name: true } } } },
        type: { select: { name: true, remindDays: true } },
      },
    }),
  ]);

  const rows: DocumentRow[] = docs
    .map((d) => {
      const status = docStatus(d.expiryDate, parseRemindDays(d.type.remindDays));
      return {
        id: d.id,
        userId: d.userId,
        userName: d.user.name,
        siteId: d.user.campusLocationId,
        siteName: d.user.campusLocation?.name ?? null,
        typeId: d.typeId,
        typeName: d.type.name,
        number: d.number,
        issueDate: d.issueDate ? pickedDateKey(d.issueDate) : null,
        expiryDate: d.expiryDate ? pickedDateKey(d.expiryDate) : null,
        daysLeft: d.expiryDate ? daysLeft(d.expiryDate) : null,
        status,
        note: d.note,
        fileName: d.attachmentName,
      };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || a.userName.localeCompare(b.userName, "th"));

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-lg font-bold">{t.titleMine}</h1>
          <p className="mt-1 text-sm text-muted">{t.hintMine}</p>
        </div>
        {rows.length === 0 && <p className="rounded-2xl border border-line bg-surface p-5 text-sm text-faint shadow-sm">{t.emptyMine}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-bold">{r.typeName}</h2>
                <span className={`badge ${DOC_STATUS_TONE[r.status]}`}>{t.status[r.status]}</span>
              </div>
              <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">{t.colNumber}</dt><dd className="font-mono">{r.number ?? "—"}</dd>
                <dt className="text-muted">{t.colIssue}</dt><dd>{r.issueDate ? formatDate(r.issueDate, locale) : "—"}</dd>
                <dt className="text-muted">{t.colExpiry}</dt>
                <dd>
                  {r.expiryDate ? formatDate(r.expiryDate, locale) : "—"}
                  {r.daysLeft !== null && <span className="ml-2 text-xs text-faint">({r.daysLeft < 0 ? t.expiredAgo(-r.daysLeft) : t.daysLeft(r.daysLeft)})</span>}
                </dd>
                {r.note && (<><dt className="text-muted">{t.colNote}</dt><dd>{r.note}</dd></>)}
              </dl>
              {r.fileName && (
                <a href={`/api/documents/${r.id}/file`} target="_blank" rel="noopener" title={r.fileName} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-ink underline">
                  <span className="rounded bg-line-soft px-1 font-mono text-[10px]">{fileKind(r.fileName)}</span>
                  {t.viewFile}
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const [teachers, sites] = await Promise.all([
    // Active people, plus anyone who already owns a document (a suspended
    // teacher's record must keep its owner when edited).
    prisma.user.findMany({ where: { OR: [{ isActive: true }, { id: { in: Array.from(new Set(docs.map((d) => d.userId))) } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.campusLocation.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-bold">{t.title}</h1>
        <p className="mt-1 text-sm text-muted">{t.hint}</p>
      </div>
      <DocumentsManager
        rows={rows}
        teachers={teachers}
        types={types.map((x) => ({ id: x.id, name: x.name }))}
        sites={sites}
        saveDocument={saveDocument}
        deleteDocument={deleteDocument}
        removeDocumentFile={removeDocumentFile}
      />
      <DocumentImport types={types.map((x) => ({ id: x.id, name: x.name }))} importDocuments={importDocuments} />
      <DocumentTypeManagement
        types={types.map((x) => ({ id: x.id, name: x.name, remindDays: x.remindDays, notifyTeacher: x.notifyTeacher, count: x._count.documents }))}
        createType={createDocumentType}
        updateType={updateDocumentType}
        deleteType={deleteDocumentType}
      />
    </div>
  );
}
