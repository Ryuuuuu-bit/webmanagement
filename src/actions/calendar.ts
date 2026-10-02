"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { DATE_KEY_RE, keyToDate } from "@/lib/calendar";

type ActionResult = { ok: boolean; message: string };

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

function parseEventInput(formData: FormData) {
  const title = ((formData.get("title") as string) || "").trim().slice(0, 200);
  const detail = ((formData.get("detail") as string) || "").trim().slice(0, 2000) || null;
  const from = ((formData.get("startDate") as string) || "").trim();
  const to = ((formData.get("endDate") as string) || "").trim() || from;
  const site = ((formData.get("campusLocationId") as string) || "").trim() || null;
  const isHoliday = formData.get("isHoliday") === "on" || formData.get("isHoliday") === "true";
  return { title, detail, from, to, site, isHoliday };
}

async function validate(input: ReturnType<typeof parseEventInput>) {
  const t = getDictionary(getLocale()).actions.schoolCalendar;
  if (!input.title) return t.fillRequired;
  if (!DATE_KEY_RE.test(input.from) || !DATE_KEY_RE.test(input.to)) return t.invalidDates;
  if (input.to < input.from) return t.endBeforeStart;
  if (input.site && !(await prisma.campusLocation.findUnique({ where: { id: input.site }, select: { id: true } }))) return t.siteNotFound;
  return null;
}

function toData(input: ReturnType<typeof parseEventInput>) {
  return {
    title: input.title,
    detail: input.detail,
    startDate: keyToDate(input.from),
    endDate: keyToDate(input.to),
    isHoliday: input.isHoliday,
    campusLocationId: input.site,
  };
}

export async function createSchoolEvent(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const t = getDictionary(getLocale()).actions.schoolCalendar;
  const input = parseEventInput(formData);
  const error = await validate(input);
  if (error) return { ok: false, message: error };
  await prisma.schoolEvent.create({ data: { ...toData(input), createdById: session.user.id } });
  revalidatePath("/calendar");
  return { ok: true, message: t.created(input.title) };
}

export async function updateSchoolEvent(id: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const t = getDictionary(getLocale()).actions.schoolCalendar;
  const input = parseEventInput(formData);
  const error = await validate(input);
  if (error) return { ok: false, message: error };
  const res = await prisma.schoolEvent.updateMany({ where: { id }, data: toData(input) });
  if (res.count === 0) return { ok: false, message: t.notFound };
  revalidatePath("/calendar");
  return { ok: true, message: t.updated(input.title) };
}

export async function deleteSchoolEvent(id: string): Promise<ActionResult> {
  await requireAdmin();
  const t = getDictionary(getLocale()).actions.schoolCalendar;
  const res = await prisma.schoolEvent.deleteMany({ where: { id } });
  if (res.count === 0) return { ok: false, message: t.notFound };
  revalidatePath("/calendar");
  return { ok: true, message: t.deleted };
}
