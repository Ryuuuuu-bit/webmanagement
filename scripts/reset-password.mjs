// One-off password reset run from the `start` script, gated like the other
// maintenance scripts: RESET_PASSWORD_USER = username, RESET_PASSWORD_VALUE =
// the new (temporary) password, MAINTENANCE_TOKEN = any new value (recorded in
// AppSetting.maintenanceToken so restarts never repeat it). For the day the
// only Admin forgets their password — there is no self-service reset by
// design. The account gets a 7-day temporary password, must change it,
// every existing session is signed out, and login lockouts are cleared.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const token = process.env.MAINTENANCE_TOKEN?.trim();
const username = (process.env.RESET_PASSWORD_USER ?? "").trim().toLowerCase();
const value = process.env.RESET_PASSWORD_VALUE ?? "";

try {
  if (!token || !username || value.length < 8) {
    console.log("[reset-password] nothing requested — skipping");
  } else {
    const setting = await prisma.appSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
    if (setting.maintenanceToken === token) {
      console.log("[reset-password] token already applied — skipping");
    } else {
      const user = await prisma.user.findUnique({ where: { username }, select: { id: true, email: true } });
      if (!user) {
        console.error(`[reset-password] no account with username ${username}`);
      } else {
        const passwordHash = await bcrypt.hash(value, 10);
        await prisma.$transaction([
          prisma.user.update({
            where: { id: user.id },
            data: {
              passwordHash,
              mustChangePassword: true,
              tempPasswordExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              passwordSetAt: null,
              isActive: true,
              tokenVersion: { increment: 1 },
            },
          }),
          prisma.loginLock.deleteMany({ where: { key: { startsWith: `e:${user.email.toLowerCase()}|` } } }),
          prisma.appSetting.update({ where: { id: "default" }, data: { maintenanceToken: token } }),
        ]);
        console.log(`[reset-password] temporary password set for ${username} (7 days, must change)`);
      }
    }
  }
} catch (err) {
  console.error("[reset-password] failed:", err?.message ?? err);
} finally {
  await prisma.$disconnect();
}
