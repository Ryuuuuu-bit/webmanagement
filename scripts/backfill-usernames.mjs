// One-time (idempotent) backfill run from the `start` script right after
// `prisma db push`: every User row that predates the `username` column gets
// one derived from the local part of their email (somchai.j@x.ac.th →
// somchai.j), de-duplicated with a numeric suffix. Rows that already have a
// username are untouched, so this is a no-op on every later start.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function slug(email) {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return local.length >= 3 ? local.slice(0, 32) : `user${local}`;
}

try {
  const missing = await prisma.user.findMany({ where: { username: null }, select: { id: true, email: true } });
  if (missing.length === 0) {
    console.log("[backfill-usernames] nothing to do");
  } else {
    const taken = new Set((await prisma.user.findMany({ where: { username: { not: null } }, select: { username: true } })).map((u) => u.username));
    for (const u of missing) {
      let base = slug(u.email);
      let candidate = base;
      let n = 2;
      while (taken.has(candidate)) candidate = `${base}${n++}`;
      taken.add(candidate);
      await prisma.user.update({ where: { id: u.id }, data: { username: candidate } });
      console.log(`[backfill-usernames] ${u.email} -> ${candidate}`);
    }
    console.log(`[backfill-usernames] set ${missing.length} username(s)`);
  }

  // passwordSetAt backfill (idempotent): accounts that demonstrably set their
  // own password (PASSWORD_CHANGED / PASSWORD_RESET_COMPLETED in the audit
  // log) get that timestamp; everyone else stays null, which just means the
  // change-password page won't ask them for a "current" password once.
  const unset = await prisma.user.findMany({ where: { passwordSetAt: null }, select: { id: true } });
  if (unset.length > 0) {
    const evidence = await prisma.auditLog.findMany({
      where: { action: { in: ["PASSWORD_CHANGED", "PASSWORD_RESET_COMPLETED"] }, targetUserId: { in: unset.map((u) => u.id) } },
      orderBy: { at: "desc" },
      select: { targetUserId: true, at: true },
    });
    const latest = new Map();
    for (const e of evidence) if (!latest.has(e.targetUserId)) latest.set(e.targetUserId, e.at);
    for (const [id, at] of latest) await prisma.user.update({ where: { id }, data: { passwordSetAt: at } });
    if (latest.size > 0) console.log(`[backfill-usernames] passwordSetAt set for ${latest.size} account(s)`);
  }
} catch (err) {
  // Never block the app from starting over this — Admin can set usernames by hand.
  console.error("[backfill-usernames] failed:", err?.message ?? err);
} finally {
  await prisma.$disconnect();
}
