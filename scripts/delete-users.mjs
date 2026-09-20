// One-off account removal run from the `start` script, gated like the demo
// seed: DELETE_USERS = comma-separated usernames, MAINTENANCE_TOKEN = any new
// value (recorded in AppSetting.maintenanceToken so restarts never repeat it).
// Removes those accounts and everything that requires them, keeps approver /
// reviewer references on other people's records as null, and refuses to
// remove the last active ADMIN. Always prints the remaining account list so
// the deploy log doubles as a verification.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const token = process.env.MAINTENANCE_TOKEN?.trim();
const targets = (process.env.DELETE_USERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

try {
  if (!token || targets.length === 0) {
    console.log("[delete-users] nothing requested — skipping");
  } else {
    const setting = await prisma.appSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
    if (setting.maintenanceToken === token) {
      console.log("[delete-users] token already applied — skipping");
    } else {
      const users = await prisma.user.findMany({ where: { username: { in: targets } }, select: { id: true, username: true, email: true, role: true } });
      const adminsLeft = await prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { notIn: users.map((u) => u.id) } } });
      if (adminsLeft === 0) {
        console.error("[delete-users] refused: no active ADMIN would remain");
      } else {
        const ids = users.map((u) => u.id);
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
        }
        console.log(`[delete-users] removed ${ids.length}: ${users.map((u) => `${u.username} (${u.role})`).join(", ") || "-"}`);
        await prisma.appSetting.update({ where: { id: "default" }, data: { maintenanceToken: token } });
      }
    }
  }
  const remaining = await prisma.user.findMany({ select: { username: true, role: true, isActive: true }, orderBy: { username: "asc" } });
  console.log(`[delete-users] accounts now: ${remaining.map((u) => `${u.username}/${u.role}${u.isActive ? "" : "/suspended"}`).join(", ")}`);
} catch (err) {
  console.error("[delete-users] failed:", err?.message ?? err);
} finally {
  await prisma.$disconnect();
}
