import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import FeedbackForm from "@/components/FeedbackForm";
import IssueList, { type IssueRow } from "@/components/IssueList";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// Never pull attachment bytes into a list — served on demand by /api/feedback/[id]/attachment.
const ISSUE_SELECT = {
  id: true, category: true, area: true, title: true, detail: true, pageUrl: true, device: true, attachmentName: true,
  status: true, adminNote: true, createdAt: true,
  reporter: { select: { name: true } }, handler: { select: { name: true } },
} as const;

type Raw = {
  id: string; category: string; area: string; title: string; detail: string; pageUrl: string | null; device: string | null;
  attachmentName: string | null; status: string; adminNote: string | null; createdAt: Date;
  reporter: { name: string } | null; handler: { name: string } | null;
};

const toRow = (r: Raw): IssueRow => ({
  id: r.id, category: r.category, area: r.area, title: r.title, detail: r.detail, pageUrl: r.pageUrl, device: r.device,
  attachmentName: r.attachmentName, status: r.status, adminNote: r.adminNote,
  handlerName: r.handler?.name ?? null, reporterName: r.reporter?.name ?? "-",
  createdAt: r.createdAt.toISOString(),
  dayKey: r.createdAt.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }),
});

export default async function FeedbackPage({ searchParams }: { searchParams?: { area?: string } }) {
  const session = await requireUser();
  const isAdmin = session.user.role === "ADMIN";
  const dict = getDictionary(getLocale());
  const t = dict.feedback;

  const [mine, all] = await Promise.all([
    prisma.issueReport.findMany({ where: { reporterId: session.user.id }, orderBy: { createdAt: "desc" }, select: ISSUE_SELECT, take: 100 }),
    isAdmin
      ? prisma.issueReport.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], select: ISSUE_SELECT, take: 500 })
      : Promise.resolve([] as Raw[]),
  ]);
  const openCount = isAdmin ? all.filter((r: Raw) => r.status === "OPEN" || r.status === "IN_PROGRESS").length : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{t.formTitle}</h2>
        <p className="mt-0.5 text-xs text-muted">{t.formHint}</p>
        <div className="mt-4">
          <FeedbackForm initialArea={searchParams?.area} />
        </div>
      </div>

      {isAdmin && (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="mb-3 text-base font-bold">
            {t.allTitle} <span className="ml-1 text-xs font-normal text-faint">{t.openCount(openCount)}</span>
          </h2>
          {all.length === 0 ? <p className="text-sm text-muted">{t.noReports}</p> : <IssueList id="issues-all" rows={all.map(toRow)} admin />}
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="mb-3 text-base font-bold">{t.myTitle}</h2>
        {mine.length === 0 ? <p className="text-sm text-muted">{t.noMine}</p> : <IssueList id="issues-mine" rows={mine.map(toRow)} admin={false} />}
      </div>
    </div>
  );
}
