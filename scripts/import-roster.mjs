// One-off teacher-roster import run from the `start` script (after the demo
// seed), for loading the client's roster on a server nobody can upload to
// yet. Same rules as "เอกสารครู → นำเข้าทะเบียนครู" (src/actions/roster.ts):
//
//   ROSTER_IMPORT=<base64 of gzipped JSON>
//     { typeNames: { passport, workPermit, license },
//       rows: [{ name, email, username, passwordHash, thaiName, nickname,
//                nationality, phone, startDate, gradeLevels: [..], subjects,
//                project, docs: [{ kind, number, issueDate, expiryDate, note }] }] }
//
// A teacher is matched by email; a missing one is created with the given
// bcrypt hash of a temporary password (handed to Admin separately, never in
// the payload or the log) and must change it at first sign-in. Fields with a
// value overwrite, blanks are left alone, grade levels are added.
// The payload's hash is recorded as an AuditLog row (ROSTER_IMPORT), so a
// restart never repeats it. Clear the variable once the deploy log shows
// "[roster] done" — it holds personal data.
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import zlib from "node:zlib";

const prisma = globalThis.__demoPrisma ?? new PrismaClient();
const raw = process.env.ROSTER_IMPORT?.trim();
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REMIND = { passport: "180,90", workPermit: "90,60", license: "90,60" };
// "YYYY-MM-DD" real calendar day (1950–2200) → UTC-midnight Date; anything else → null.
const day = (k) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k ?? "")) return null;
  const y = +k.slice(0, 4);
  const d = new Date(`${k}T00:00:00.000Z`);
  return y >= 1950 && y <= 2200 && !isNaN(d) && d.toISOString().slice(0, 10) === k ? d : null;
};
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

try {
  if (!raw) {
    console.log("[roster] ROSTER_IMPORT not set — skipping");
  } else {
    const token = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
    if (await prisma.auditLog.findFirst({ where: { action: "ROSTER_IMPORT", detail: { startsWith: `token=${token}` } } })) {
      console.log("[roster] payload already imported — skipping (clear ROSTER_IMPORT)");
    } else {
      const data = JSON.parse(zlib.gunzipSync(Buffer.from(raw, "base64")).toString("utf8"));
      const types = await prisma.documentType.findMany({ select: { id: true, name: true, sortOrder: true } });
      let order = types.reduce((m, x) => Math.max(m, x.sortOrder), 0);
      const typeId = {};
      for (const [kind, name] of Object.entries(data.typeNames ?? {})) {
        const found = types.find((x) => norm(x.name) === norm(name));
        typeId[kind] = found ? found.id : (await prisma.documentType.create({ data: { name, remindDays: REMIND[kind] ?? "90,60", sortOrder: ++order } })).id;
      }
      const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
      let created = 0, updated = 0, docs = 0, failed = 0;
      for (const r of data.rows ?? []) {
        try {
          const email = norm(r.email);
          // Same rules as the in-app import: a real, non-demo email; a sign-in-able
          // username; a bcrypt hash (never a plain password).
          if (!/^\S+@\S+\.\S+$/.test(email) || email.endsWith("@demo.local")) throw new Error(`invalid email "${r.email ?? ""}"`);
          if (r.passwordHash && !/^\$2[aby]\$\d\d\$.{53}$/.test(r.passwordHash)) throw new Error("passwordHash is not a bcrypt hash");
          r.username = String(r.username ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "") || email.split("@")[0].replace(/[^a-z0-9._-]/g, "");
          let user = await prisma.user.findUnique({ where: { email }, select: { id: true, gradeLevels: true } });
          if (!user) {
            let username = r.username;
            for (let n = 2; await prisma.user.findUnique({ where: { username } }); n++) username = `${r.username}${n}`;
            if (username !== r.username) console.log(`[roster] username ${r.username} taken → ${username}`);
            user = await prisma.user.create({
              data: { name: r.name, username, email, passwordHash: r.passwordHash, role: "MEMBER", mustChangePassword: true, tempPasswordExpiresAt: new Date(Date.now() + TTL_MS) },
              select: { id: true, gradeLevels: true },
            });
            await prisma.auditLog.create({ data: { action: "USER_CREATED", actorId: admin?.id ?? null, targetUserId: user.id, detail: `${email} (roster import)` } });
            created++;
          } else updated++;
          const grades = Array.from(new Set([...user.gradeLevels, ...(r.gradeLevels ?? [])]));
          const patch = {};
          for (const k of ["thaiName", "nickname", "nationality", "phone", "subjects", "project"]) if (r[k]) patch[k] = r[k];
          if (day(r.startDate)) patch.startDate = day(r.startDate);
          if (grades.length !== user.gradeLevels.length) patch.gradeLevels = grades;
          if (Object.keys(patch).length) await prisma.user.update({ where: { id: user.id }, data: patch });
          for (const d of r.docs ?? []) {
            if (!typeId[d.kind]) continue;
            const p = {};
            if (d.number) p.number = d.number;
            if (d.note) p.note = d.note;
            if (day(d.issueDate)) p.issueDate = day(d.issueDate);
            if (day(d.expiryDate)) p.expiryDate = day(d.expiryDate);
            if (!Object.keys(p).length) continue;
            await prisma.teacherDocument.upsert({ where: { userId_typeId: { userId: user.id, typeId: typeId[d.kind] } }, update: p, create: { userId: user.id, typeId: typeId[d.kind], ...p } });
            docs++;
          }
        } catch (err) {
          failed++;
          console.error(`[roster] row ${r.email} failed:`, err?.message ?? err);
        }
      }
      await prisma.auditLog.create({ data: { action: "ROSTER_IMPORT", actorId: admin?.id ?? null, detail: `token=${token} created=${created} updated=${updated} documents=${docs} failed=${failed}` } });
      console.log(`[roster] done: ${created} accounts created, ${updated} updated, ${docs} documents, ${failed} failed`);
    }
  }
} catch (err) {
  console.error("[roster] failed:", err?.message ?? err);
} finally {
  await prisma.$disconnect();
}
