"use server";

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import type { GradeLevel } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isDateKey, keyToDate } from "@/lib/calendar";
import { logAudit } from "@/lib/audit";
import { notifyUser } from "@/lib/notify";
import { getClientIp, normalizeUsername, USERNAME_RE } from "@/lib/security";
import { cleanPersonName, parseGradeLevels } from "@/lib/roster";

/**
 * "นำเข้าทะเบียนครู": the client's HR sheet (TeacherData.xlsx) has ONE row
 * per teacher with several documents side by side (passport, work permit,
 * teaching licence) plus roster details. One import:
 *   1. finds the teacher (email → username → exact name), or creates the
 *      account (temporary password, like the users import) when allowed;
 *   2. fills the roster fields that have a value (never blanks one out);
 *   3. adds the grade levels from "Class teaching level" (kept, not replaced);
 *   4. upserts each document group like the documents import (empty cells
 *      leave the stored value alone, so re-importing a newer sheet renews).
 * Birth date, emergency contacts and TOEIC are never sent by the client.
 */

export type RosterDocKind = "passport" | "workPermit" | "license";
export type RosterDoc = { kind: RosterDocKind; number: string; issueDate: string; expiryDate: string; note: string };
export type RosterRow = {
  row: number;
  name: string;
  email: string;
  username: string;
  thaiName: string;
  nickname: string;
  nationality: string;
  phone: string;
  startDate: string;
  classLevels: string;
  subjects: string;
  project: string;
  docs: RosterDoc[];
};
export type RosterOptions = { createMissing: boolean; siteId: string | null; typeNames: Record<RosterDocKind, string> };
export type RosterResult = {
  row: number;
  name: string;
  email: string;
  username: string | null;
  account: "created" | "matched" | "skipped" | "failed";
  docs: number;
  tempPassword?: string;
  message: string;
};

// Same rules as accounts made in /admin/users (src/actions/users.ts) — keep in sync.
const TEMP_PASSWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function generateTempPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
const isValidEmail = (email: string) => /^\S+@\S+\.\S+$/.test(email) && !email.toLowerCase().endsWith("@demo.local");

const DEFAULT_REMIND: Record<RosterDocKind, string> = { passport: "180,90", workPermit: "90,60", license: "90,60" };

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");
  return session;
}

const s = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

export async function importRoster(
  rows: RosterRow[],
  options: RosterOptions
): Promise<{ ok: boolean; message: string; results: RosterResult[] }> {
  const session = await requireAdmin();
  const dict = getDictionary(getLocale());
  const t = dict.actions.roster;
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, message: t.empty, results: [] };
  if (rows.length > 500) return { ok: false, message: t.tooMany(500), results: [] };

  const [users, types] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, username: true, email: true, gradeLevels: true } }),
    prisma.documentType.findMany({ select: { id: true, name: true, sortOrder: true } }),
  ]);
  const siteId = options?.siteId ? (await prisma.campusLocation.findUnique({ where: { id: options.siteId }, select: { id: true } }))?.id ?? null : null;

  // Lookup keys → user id (null = two people share the key: refuse to guess).
  const byEmail = new Map<string, string>();
  const byUsername = new Map<string, string>();
  const byName = new Map<string, string | null>();
  const grades = new Map<string, GradeLevel[]>();
  const usernameOf = new Map<string, string | null>();
  const remember = (u: { id: string; name: string; username: string | null; email: string; gradeLevels: GradeLevel[] }) => {
    byEmail.set(u.email.toLowerCase(), u.id);
    if (u.username) byUsername.set(u.username, u.id);
    const k = norm(u.name);
    byName.set(k, byName.has(k) && byName.get(k) !== u.id ? null : u.id);
    grades.set(u.id, u.gradeLevels);
    usernameOf.set(u.id, u.username);
  };
  users.forEach(remember);

  // Document types: the Admin picked (or typed) a name per group; a new name is created.
  let maxOrder = types.reduce((m, x) => Math.max(m, x.sortOrder), 0);
  const typeIds: Partial<Record<RosterDocKind, string>> = {};
  for (const kind of ["passport", "workPermit", "license"] as RosterDocKind[]) {
    const name = s(options?.typeNames?.[kind], 100);
    if (!name) continue;
    const found = types.find((x) => norm(x.name) === norm(name));
    typeIds[kind] = found ? found.id : (await prisma.documentType.create({ data: { name, remindDays: DEFAULT_REMIND[kind], sortOrder: ++maxOrder } })).id;
  }

  const optDate = (v: string): Date | null | "invalid" => (!v ? null : isDateKey(v) ? keyToDate(v) : "invalid");

  const results: RosterResult[] = [];
  let created = 0, matched = 0, docCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? ({} as RosterRow);
    const name = cleanPersonName(s(r.name, 120));
    const email = s(r.email, 200).toLowerCase();
    const base = { row: Number(r.row) > 0 ? Number(r.row) : i + 2, name, email, username: null as string | null, docs: 0 };
    if (!name && !email) {
      results.push({ ...base, account: "failed", message: t.noName });
      continue;
    }

    try {
      // 1. find or create the account
      const wantUsername = normalizeUsername(s(r.username, 64));
      let userId: string | null | undefined =
        (email && byEmail.get(email)) || (wantUsername && byUsername.get(wantUsername)) || undefined;
      if (userId === undefined && name) userId = byName.get(norm(name));
      if (userId === null) {
        results.push({ ...base, account: "failed", message: t.ambiguous });
        continue;
      }
      let tempPassword: string | undefined;
      let account: RosterResult["account"] = "matched";
      const notes: string[] = [];

      if (!userId) {
        if (!options?.createMissing) {
          results.push({ ...base, account: "skipped", message: t.noAccount });
          continue;
        }
        if (!name || !isValidEmail(email)) {
          results.push({ ...base, account: "failed", message: t.needNameEmail });
          continue;
        }
        const username = pickUsername(wantUsername, email, byUsername);
        tempPassword = generateTempPassword();
        const user = await prisma.user.create({
          data: {
            name, username, email,
            passwordHash: await bcrypt.hash(tempPassword, 10),
            role: "MEMBER",
            campusLocationId: siteId ?? undefined,
            mustChangePassword: true,
            tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS),
          },
          select: { id: true, name: true, username: true, email: true, gradeLevels: true },
        });
        remember(user);
        userId = user.id;
        account = "created";
        created++;
        await logAudit({ action: "USER_CREATED", actorId: session.user.id, targetUserId: user.id, ip: getClientIp(), detail: `${email} (roster import)` });
        await notifyUser(user.id, "PASSWORD_TEMP", { expiresAt: new Date(Date.now() + TEMP_PASSWORD_TTL_MS).toISOString() }, "/change-password");
      } else {
        matched++;
      }
      const uid: string = userId;

      // 2–3. roster fields + grade levels
      const start = optDate(s(r.startDate, 20));
      if (start === "invalid") notes.push(t.badDate(dict.roster.fields.startDate));
      const levels = parseGradeLevels(s(r.classLevels, 300));
      const current = grades.get(uid) ?? [];
      const merged = Array.from(new Set([...current, ...levels]));
      const patch = {
        ...(s(r.thaiName, 120) ? { thaiName: s(r.thaiName, 120) } : {}),
        ...(s(r.nickname, 60) ? { nickname: s(r.nickname, 60) } : {}),
        ...(s(r.nationality, 60) ? { nationality: s(r.nationality, 60) } : {}),
        ...(s(r.phone, 40) ? { phone: s(r.phone, 40) } : {}),
        ...(s(r.subjects, 200) ? { subjects: s(r.subjects, 200) } : {}),
        ...(s(r.project, 60) ? { project: s(r.project, 60) } : {}),
        ...(start && start !== "invalid" ? { startDate: start } : {}),
        ...(merged.length !== current.length ? { gradeLevels: merged } : {}),
      };
      if (Object.keys(patch).length) await prisma.user.update({ where: { id: uid }, data: patch });
      if (merged.length !== current.length) grades.set(uid, merged);

      // 4. documents
      let docs = 0;
      for (const d of Array.isArray(r.docs) ? r.docs : []) {
        const typeId = typeIds[d?.kind];
        if (!typeId) continue;
        const number = s(d.number, 100);
        const note = s(d.note, 1000);
        let issue = optDate(s(d.issueDate, 20));
        let expiry = optDate(s(d.expiryDate, 20));
        if (issue === "invalid" || expiry === "invalid") {
          notes.push(t.badDate(options.typeNames[d.kind]));
          if (issue === "invalid") issue = null;
          if (expiry === "invalid") expiry = null;
        }
        const docPatch = {
          ...(number ? { number } : {}),
          ...(note ? { note } : {}),
          ...(issue ? { issueDate: issue } : {}),
          ...(expiry ? { expiryDate: expiry } : {}),
        };
        if (Object.keys(docPatch).length === 0) continue;
        await prisma.teacherDocument.upsert({
          where: { userId_typeId: { userId: uid, typeId } },
          update: docPatch,
          create: { userId: uid, typeId, ...docPatch },
        });
        docs++;
      }
      docCount += docs;
      results.push({
        ...base,
        username: usernameOf.get(uid) ?? null,
        account,
        docs,
        tempPassword,
        message: [account === "created" ? t.created : t.matched, ...notes].join(" · "),
      });
    } catch (err) {
      console.error(`importRoster: row ${base.row} (${email}) failed:`, err);
      results.push({ ...base, account: "failed", message: t.rowFailed });
    }
  }

  await logAudit({
    action: "DOCUMENT_CHANGED",
    actorId: session.user.id,
    detail: `roster import: ${created} created, ${matched} matched, ${docCount} documents, ${rows.length} rows`,
  });
  revalidatePath("/documents");
  revalidatePath("/admin/users");
  revalidatePath("/teachers");
  return { ok: created + matched > 0, message: t.summary(created, matched, docCount, results.filter((x) => x.account === "failed" || x.account === "skipped").length), results };
}

/** The sheet's username if usable, else the email's local part — made unique with a number. */
function pickUsername(wanted: string, email: string, taken: Map<string, string>) {
  let base = USERNAME_RE.test(wanted) ? wanted : email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 28);
  if (base.length < 3) base = (base + "teacher").slice(0, 28);
  let u = base;
  for (let n = 2; taken.has(u); n++) u = `${base}${n}`;
  return u;
}
