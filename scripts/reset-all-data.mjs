// One-off FULL reset run from the `start` script (before the demo seed),
// gated like the other maintenance scripts:
//
//   RESET_ALL_DATA=<any new value>   wipe everything except the Admin accounts
//
// Removes every MEMBER account and all data — attendance, leave, timetables,
// courses, rooms, semesters, schools, departments, calendar, documents,
// notifications, reports and the audit log. Kept: ADMIN accounts (with their
// passkeys and push devices, so nobody is locked out), system settings
// (AppSetting) and the document types. Cannot be undone.
//
// The applied value is recorded as an AuditLog row (action RESET_ALL_DATA)
// written AFTER the wipe, so a restart never repeats it; set a new value to
// run it again on purpose. The deploy log lists what was kept.
import { PrismaClient } from "@prisma/client";

const prisma = globalThis.__demoPrisma ?? new PrismaClient();
const token = process.env.RESET_ALL_DATA?.trim();

try {
  if (!token) {
    console.log("[reset-all] RESET_ALL_DATA not set — skipping");
  } else if (await prisma.auditLog.findFirst({ where: { action: "RESET_ALL_DATA", detail: `token=${token}` } })) {
    console.log("[reset-all] token already applied — skipping");
  } else {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true, username: true, email: true } });
    if (admins.length === 0) {
      console.error("[reset-all] refused: there is no ADMIN account to keep");
    } else {
      const keep = admins.map((a) => a.id);
      const notAdmin = { userId: { notIn: keep } };
      const counts = {};
      const run = async (name, fn) => { counts[name] = (await fn()).count; };
      await prisma.$transaction(async (tx) => {
        // records that hang off people / classes first
        await run("substitutes", () => tx.substituteAssignment.deleteMany({}));
        await run("documents", () => tx.teacherDocument.deleteMany({}));
        await run("notifications", () => tx.notification.deleteMany({}));
        await run("reminders", () => tx.reminderLog.deleteMany({}));
        await run("issueReports", () => tx.issueReport.deleteMany({}));
        await run("selfies", () => tx.selfie.deleteMany({}));
        await run("lessonPlans", () => tx.lessonPlan.deleteMany({}));
        await run("attestations", () => tx.timeAttestation.deleteMany({}));
        await run("leaveRequests", () => tx.leaveRequest.deleteMany({}));
        await run("attendance", () => tx.attendance.deleteMany({}));
        await run("schedules", () => tx.schedule.deleteMany({}));
        await run("userSites", () => tx.userSite.deleteMany({}));
        await run("events", () => tx.schoolEvent.deleteMany({}));
        await run("enrollmentTokens", () => tx.enrollmentToken.deleteMany({}));
        await run("loginTickets", () => tx.loginTicket.deleteMany({}));
        await run("resetTokens", () => tx.passwordResetToken.deleteMany({}));
        await run("loginLocks", () => tx.loginLock.deleteMany({}));
        await run("challenges", () => tx.webauthnChallenge.deleteMany({}));
        // Keep the "already ran" markers of the boot scripts (demo data, roster
        // import, this reset): wiping them made those scripts run again in the
        // same boot and refill the freshly cleared system.
        await run("auditLog", () => tx.auditLog.deleteMany({ where: { action: { notIn: ["DEMO_DATA", "ROSTER_IMPORT", "RESET_ALL_DATA"] } } }));
        await run("passkeys", () => tx.webauthnCredential.deleteMany({ where: notAdmin }));
        await run("pushDevices", () => tx.pushSubscription.deleteMany({ where: notAdmin }));
        // people (Admins stay, detached from the schools/departments about to go)
        await tx.user.updateMany({ where: { id: { in: keep } }, data: { departmentId: null, campusLocationId: null } });
        await run("users", () => tx.user.deleteMany({ where: { id: { notIn: keep } } }));
        // master data
        await run("courses", () => tx.course.deleteMany({}));
        await run("rooms", () => tx.room.deleteMany({}));
        await run("semesters", () => tx.semester.deleteMany({}));
        await run("schools", () => tx.campusLocation.deleteMany({}));
        await run("departments", () => tx.department.deleteMany({}));
      }, { timeout: 120_000, maxWait: 20_000 });
      await prisma.auditLog.create({ data: { action: "RESET_ALL_DATA", actorId: keep[0], detail: `token=${token}` } });
      console.log(`[reset-all] wiped: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
      console.log(`[reset-all] kept ADMIN accounts: ${admins.map((a) => a.username || a.email).join(", ")}`);
    }
  }
} catch (err) {
  console.error("[reset-all] failed (nothing was removed if the wipe itself failed):", err?.message ?? err);
} finally {
  await prisma.$disconnect();
}
