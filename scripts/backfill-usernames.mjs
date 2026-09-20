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
} catch (err) {
  // Never block the app from starting over this — Admin can set usernames by hand.
  console.error("[backfill-usernames] failed:", err?.message ?? err);
} finally {
  await prisma.$disconnect();
}
