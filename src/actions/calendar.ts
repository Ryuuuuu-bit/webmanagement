"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { DATE_KEY_RE, keyToDate } from "@/lib/calendar";
import { copyEventsToNextYear, importEventRows, type BulkEventResult, type BulkEventRow } from "@/lib/calendarBulk";

type ActionResult = { ok: boolean; message: string };

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

function revalidate() {
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  revalidatePath("/substitutes");
}

/** Known school ids out of `ids` (unknown / deleted ones dropped), sorted for stable comparison. */
async function validSites(ids: string[]): Promise<string[] | null> {
  const want = Array.from(new Set(ids.filter(Boolean)));
  if (want.length === 0) return [];
  const found = await prisma.campusLocation.findMany({ where: { id: { in: want } }, select: { id: true } });
  return found.length === want.length ? want.sort() : null;
}

function parseEventInput(formData: FormData) {
  const title = ((formData.get("title") as string) || "").trim().slice(0, 200);
  const detail = ((formData.get("detail") as string) || "").trim().slice(0, 2000) || null;
  const from = ((formData.get("startDate") as string) || "").trim();
  const to = ((formData.get("endDate") as string) || "").trim() || from;
  // Checkbox list of schools; none ticked = every school.
  const sites = formData.getAll("siteIds").map(String);
  const isHoliday = formData.get("isHoliday") === "on" || formData.get("isHoliday") === "true";
  return { title, detail, from, to, sites, isHoliday };
}

async function validate(input: ReturnType<typeof parseEventInput>) {
  const t = getDictionary(getLocale()).actions.schoolCalendar;
  if (!input.title) return { error: t.fillRequired };
  if (!DATE_KEY_RE.test(input.from) || !DATE_KEY_RE.test(input.to) || isNaN(keyToDate(input.from).getTime()) || isNaN(keyToDate(input.to).getTime())) return { error: t.invalidDates };
  if (input.to < input.from) return { error: t.endBeforeStart };
  if (Date.parse(input.to) - Date.parse(input.from) > 366 * 86_400_000) return { error: t.tooLong };
  const sites = await validSites(input.sites);
  if (!sites) return { error: t.siteNotFound };
  return { sites };
}

function toData(input: ReturnType<typeof parseEventInput>, sites: string[]) {
  return {
    title: input.title,
    detail: input.detail,
    startDate: keyToDate(input.from),
    endDate: keyToDate(input.to),
    isHoliday: input.isHoliday,
    siteIds: sites,
    campusLocationId: null,
  };
}

export async function createSchoolEvent(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const t = getDictionary(getLocale()).actions.schoolCalendar;
  const input = parseEventInput(formData);
  const v = await validate(input);
  if ("error" in v) return { ok: false, message: v.error! };
  await prisma.schoolEvent.create({ data: { ...toData(input, v.sites), createdById: session.user.id } });
  revalidate();
  return { ok: true, message: t.created(input.title) };
}

/** One event = one row, so editing or deleting it applies to every school it lists. */
export async function updateSchoolEvent(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const t = getDictionary(getLocale()).actions.schoolCalendar;
  const input = parseEventInput(formData);
  const v = await validate(input);
  if ("error" in v) return { ok: false, message: v.error! };
  const res = await prisma.schoolEvent.updateMany({ where: { id }, data: toData(input, v.sites) });
  if (res.count === 0) return { ok: false, message: t.notFound };
  revalidate();
  return { ok: true, message: t.updated(input.title) };
}

export async function deleteSchoolEvent(id: string): Promise<ActionResult> {
  await requireAdmin();
  const t = getDictionary(getLocale()).actions.schoolCalendar;
  const res = await prisma.schoolEvent.deleteMany({ where: { id } });
  if (res.count === 0) return { ok: false, message: t.notFound };
  revalidate();
  return { ok: true, message: t.deleted };
}

// --- bulk: import / public-holiday presets / copy a year --------------------

export type { BulkEventRow, BulkEventResult };

/** Excel/CSV import and the public-holiday picker (see importEventRows). */
export async function importSchoolEvents(rows: BulkEventRow[]): Promise<{ ok: boolean; message: string; results: BulkEventResult[] }> {
  const session = await requireAdmin();
  const res = await importEventRows(rows, session.user.id, getDictionary(getLocale()).actions.schoolCalendar);
  revalidate();
  return res;
}

/** "คัดลอกจากปีที่แล้ว" (see copyEventsToNextYear). */
export async function copySchoolEventsToNextYear(fromYear: number, siteId: string | null): Promise<ActionResult> {
  const session = await requireAdmin();
  const res = await copyEventsToNextYear(fromYear, siteId, session.user.id, getDictionary(getLocale()).actions.schoolCalendar);
  revalidate();
  return res;
}
