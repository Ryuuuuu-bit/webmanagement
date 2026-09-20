// One-off demo reset, run from the `start` script and gated by the
// SEED_DEMO_USERS variable: when it is set to a value that AppSetting.seedToken
// has not recorded yet, every MEMBER account (and its schedules, attendance,
// leave/attest requests, lesson plans, devices) is removed and three mock
// teachers are created with a known temporary password. The token is then
// stored so restarts never repeat it; changing the variable's value runs it
// again on purpose. ADMIN accounts are never touched.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const token = process.env.SEED_DEMO_USERS?.trim();

const DEMO_PASSWORD = "Teach2569";
const DEMO_USERS = [
  { name: "อ.สมชาย ใจดี", username: "somchai", email: "somchai@demo.local" },
  { name: "อ.สมหญิง รักเรียน", username: "somying", email: "somying@demo.local" },
  { name: "อ.วิชัย มั่นคง", username: "wichai", email: "wichai@demo.local" },
];

try {
  if (!token) {
    console.log("[seed-demo] SEED_DEMO_USERS not set — skipping");
  } else {
    const setting = await prisma.appSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
    if (setting.seedToken === token) {
      console.log("[seed-demo] token already applied — skipping");
    } else {
      const members = await prisma.user.findMany({ where: { role: "MEMBER" }, select: { id: true, email: true } });
      const ids = members.map((m) => m.id);
      if (ids.length) {
        await prisma.$transaction([
          prisma.schedule.deleteMany({ where: { teacherId: { in: ids } } }),
          prisma.attendance.deleteMany({ where: { userId: { in: ids } } }),
          prisma.leaveRequest.updateMany({ where: { approverId: { in: ids } }, data: { approverId: null } }),
          prisma.leaveRequest.deleteMany({ where: { requesterId: { in: ids } } }),
          prisma.timeAttestation.updateMany({ where: { approverId: { in: ids } }, data: { approverId: null } }),
          prisma.timeAttestation.deleteMany({ where: { requesterId: { in: ids } } }),
          prisma.lessonPlan.updateMany({ where: { reviewerId: { in: ids } }, data: { reviewerId: null } }),
          prisma.lessonPlan.deleteMany({ where: { teacherId: { in: ids } } }),
          prisma.selfie.deleteMany({ where: { userId: { in: ids } } }),
          prisma.user.deleteMany({ where: { id: { in: ids } } }),
        ]);
        console.log(`[seed-demo] removed ${ids.length} member account(s): ${members.map((m) => m.email).join(", ")}`);
      }
      const [dept, site] = await Promise.all([
        prisma.department.findFirst({ orderBy: { name: "asc" } }),
        prisma.campusLocation.findFirst({ orderBy: { name: "asc" } }),
      ]);
      const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      for (const u of DEMO_USERS) {
        await prisma.user.create({
          data: {
            ...u,
            passwordHash,
            role: "MEMBER",
            mustChangePassword: true,
            tempPasswordExpiresAt: expires,
            departmentId: dept?.id ?? null,
            campusLocationId: site?.id ?? null,
          },
        });
        console.log(`[seed-demo] created ${u.username} <${u.email}>`);
      }
      await prisma.appSetting.update({ where: { id: "default" }, data: { seedToken: token } });
      console.log("[seed-demo] done");
    }
  }
} catch (err) {
  console.error("[seed-demo] failed:", err?.message ?? err);
} finally {
  await prisma.$disconnect();
}
