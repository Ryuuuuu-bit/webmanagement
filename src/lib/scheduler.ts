import { prisma } from "./prisma";
import { getAutomationSettings } from "./automation";
import { atTimeOfDay, getCheckinPolicy, workHoursForSite, TIME_RE } from "./settings";
import { bangkokDateKey, pickedDateKey, todayAtMidnight, toWeekdayIndex } from "./date";
import { notifyAdmins, notifyUser } from "./notify";
import { daysUntilDue } from "./semesters";
import { isMissing, lessonPlanSlots } from "./lessonPlans";
import { logAudit } from "./audit";
import { holidaysOn, isHolidayFor } from "./calendar";
import { daysLeft, parseRemindDays } from "./documents";
import { markAbsences } from "./absence";

/**
 * Background jobs, run every few minutes (src/instrumentation.ts starts the
 * ticker inside the web process; /api/cron can also trigger a run).
 *
 *  - check-in reminder   : a teacher hasn't checked in N min after start+grace
 *  - check-out reminder  : checked in, not out, N min after the site's end time
 *  - pending digest      : daily note to Admins about requests waiting > N days
 *  - lesson plan due     : D-7 / D-1 / due day to teachers still missing plans,
 *                          the day after: "overdue" to them + a summary to Admins
 *  - document expiry     : work permit / visa / … reminders at each type's
 *                          "days before" thresholds, then once when expired
 *  - automatic ABSENT    : past work days with no record and no leave (opt-in,
 *                          see src/lib/absence.ts)
 *  - retention purge     : PDPA retention windows (attendance, attachments, selfies)
 *
 * Every send first claims a ReminderLog key, so a reminder goes out at most
 * once no matter how often ticks run, how many replicas there are, or
 * whether a deploy restarts the process mid-day.
 */

async function claim(key: string): Promise<boolean> {
  try {
    await prisma.reminderLog.create({ data: { key } });
    return true;
  } catch (err) {
    // Duck-typed (not instanceof): the error class can come from a different
    // copy of the client than the one imported here.
    if ((err as { code?: string } | null)?.code === "P2002") return false;
    throw err;
  }
}

export type TickResult = Record<string, number>;

export async function runScheduledJobs(now = new Date()): Promise<TickResult> {
  const out: TickResult = { checkinReminders: 0, checkoutReminders: 0, digests: 0, lessonPlanReminders: 0, documentReminders: 0, absent: 0, purged: 0 };
  const settings = await getAutomationSettings();
  const policy = await getCheckinPolicy();
  const todayKey = bangkokDateKey(now);
  const today = todayAtMidnight();
  const weekday = toWeekdayIndex(now);
  const isWorkday = settings.remindWeekdays.includes(weekday);

  // --- check-in / check-out reminders -------------------------------------
  if (settings.remindCheckin || settings.remindCheckout) {
    const teachers = await prisma.user.findMany({
      // Only people who have actually started using the app (logged in once).
      where: { role: "MEMBER", isActive: true, lastLoginAt: { not: null }, campusLocationId: { not: null } },
      select: { id: true, campusLocationId: true, campusLocation: { select: { workStart: true, workEnd: true, lateGraceMinutes: true } } },
    });
    // School-calendar holidays (whole system or the teacher's own school): no check-in nudge.
    const holidays = await holidaysOn(todayKey);
    const ids = teachers.map((t) => t.id);
    const [rows, halfDays] = await Promise.all([
      prisma.attendance.findMany({ where: { userId: { in: ids }, date: today } }),
      prisma.leaveRequest.findMany({
        where: { requesterId: { in: ids }, status: "APPROVED", halfDay: { not: null }, startDate: { gte: new Date(+today - 2 * 86_400_000), lte: new Date(+today + 2 * 86_400_000) } },
        select: { requesterId: true, halfDay: true, startDate: true },
      }),
    ]);
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    // Same normalisation decideLeave uses before writing LEAVE rows.
    const amLeave = new Set(
      halfDays
        .filter((l) => {
          const d = new Date(l.startDate);
          d.setHours(0, 0, 0, 0);
          return l.halfDay === "AM" && d.getTime() === today.getTime();
        })
        .map((l) => l.requesterId)
    );

    for (const t of teachers) {
      const hours = workHoursForSite(t.campusLocation, policy);
      const row = byUser.get(t.id);
      const end = atTimeOfDay(today, hours.end);

      if (settings.remindCheckin && isWorkday && !isHolidayFor(holidays, t.campusLocationId) && !row?.checkinAt && !row?.checkoutAt && row?.status !== "LEAVE") {
        // Morning half-day leave: they're due at the afternoon start instead.
        const startTime = amLeave.has(t.id) && policy.afternoonStart > hours.start ? policy.afternoonStart : hours.start;
        const remindAt = new Date(+atTimeOfDay(today, startTime) + (hours.graceMinutes + settings.remindCheckinAfterMin) * 60_000);
        if (now >= remindAt && now < end && (await claim(`in:${t.id}:${todayKey}`))) {
          await notifyUser(t.id, "CHECKIN_REMINDER", { start: startTime }, "/checkin");
          out.checkinReminders++;
        }
      }

      if (settings.remindCheckout && row?.checkinAt && !row.checkoutAt) {
        const remindAt = new Date(+end + settings.remindCheckoutAfterMin * 60_000);
        if (now >= remindAt && now.getHours() < 23 && (await claim(`out:${t.id}:${todayKey}`))) {
          await notifyUser(t.id, "CHECKOUT_REMINDER", { end: hours.end }, "/checkin");
          out.checkoutReminders++;
        }
      }
    }
  }

  // --- daily digest of requests waiting too long --------------------------
  const digestTime = TIME_RE.test(settings.pendingDigestTime) ? settings.pendingDigestTime : "09:00";
  if (settings.pendingDigest && isWorkday && now >= atTimeOfDay(today, digestTime)) {
    const cutoff = new Date(+now - settings.pendingDigestDays * 86_400_000);
    const [leave, attest, lessonPlans, devices] = await Promise.all([
      prisma.leaveRequest.count({ where: { status: "PENDING", createdAt: { lt: cutoff } } }),
      prisma.timeAttestation.count({ where: { status: "PENDING", createdAt: { lt: cutoff } } }),
      prisma.lessonPlan.count({ where: { status: "PENDING", submittedAt: { lt: cutoff } } }),
      prisma.webauthnCredential.count({ where: { pending: true, createdAt: { lt: cutoff } } }),
    ]);
    if (leave + attest + lessonPlans + devices > 0 && (await claim(`digest:${todayKey}`))) {
      const href = leave ? "/leave" : attest ? "/attest" : lessonPlans ? "/lesson-plans" : "/checkin";
      await notifyAdmins("PENDING_DIGEST", { leave, attest, lessonPlans, devices, days: settings.pendingDigestDays }, href);
      out.digests++;
    }
  }

  // --- lesson plan deadlines ----------------------------------------------
  if (settings.lessonPlanReminders && now.getHours() >= 9) {
    const semesters = await prisma.semester.findMany({
      where: { lessonPlanDueDate: { gte: new Date(+now - 3 * 86_400_000), lte: new Date(+now + 8 * 86_400_000) } },
      select: { id: true, name: true, lessonPlanDueDate: true },
    });
    for (const sem of semesters) {
      const due = sem.lessonPlanDueDate!;
      const left = daysUntilDue(due, now);
      if (![7, 1, 0, -1].includes(left)) continue;
      const slots = (await lessonPlanSlots(sem.id)).filter(isMissing);
      const perTeacher = new Map<string, number>();
      for (const s of slots) perTeacher.set(s.teacherId, (perTeacher.get(s.teacherId) ?? 0) + 1);
      const params = { semester: sem.name, due: pickedDateKey(due), daysLeft: left };
      for (const [teacherId, missing] of perTeacher) {
        const kind = left < 0 ? "LESSON_PLAN_OVERDUE" : "LESSON_PLAN_DUE";
        if (await claim(`lp:${sem.id}:${left}:${teacherId}`)) {
          await notifyUser(teacherId, kind, { ...params, missing }, "/lesson-plans");
          out.lessonPlanReminders++;
        }
      }
      if (left === -1 && perTeacher.size > 0 && (await claim(`lpadm:${sem.id}`))) {
        await notifyAdmins("LESSON_PLANS_MISSING", { ...params, teachers: perTeacher.size, plans: slots.length }, `/lesson-plans?semester=${sem.id}`);
        out.lessonPlanReminders++;
      }
    }
  }

  // --- personnel document expiry -----------------------------------------
  if (now.getHours() >= 8) {
    out.documentReminders = await remindExpiringDocuments(now);
  }

  // --- automatic ABSENT for past work days (once a day, after 01:00) -----
  if (settings.autoAbsent && now.getHours() >= 1 && (await claim(`absent:${todayKey}`))) {
    out.absent = await markAbsences(now);
  }

  // --- PDPA retention purge (once a day, after 02:00) ----------------------
  if (now.getHours() >= 2 && (await claim(`purge:${todayKey}`))) {
    out.purged = await purgeExpiredData(now, settings.attendanceRetentionMonths, settings.attachmentRetentionMonths, policy.selfieRetentionDays);
  }

  return out;
}

/**
 * One reminder per document per stage: the smallest "days before" threshold
 * already reached, or "expired". The stage is recorded on the row as
 * "<expiry>:<stage>" (claimed with a compare-and-set so replicas can't both
 * send), so editing the expiry date after a renewal resets it — and if the
 * new date is outside every threshold, nothing is sent at all.
 */
async function remindExpiringDocuments(now: Date): Promise<number> {
  const docs = await prisma.teacherDocument.findMany({
    where: { expiryDate: { not: null, lte: new Date(+now + 731 * 86_400_000) }, user: { isActive: true } },
    select: {
      id: true, userId: true, expiryDate: true, remindedFor: true,
      user: { select: { name: true } },
      type: { select: { name: true, remindDays: true, notifyTeacher: true } },
    },
  });
  const sent: { name: string; type: string; left: number }[] = [];
  for (const d of docs) {
    const left = daysLeft(d.expiryDate!, now);
    const reached = parseRemindDays(d.type.remindDays).filter((t) => left <= t);
    const stage = left < 0 ? "expired" : reached.length ? String(Math.min(...reached)) : null;
    if (!stage) continue;
    const mark = `${pickedDateKey(d.expiryDate!)}:${stage}`;
    if (d.remindedFor === mark) continue;
    const claimed = await prisma.teacherDocument.updateMany({ where: { id: d.id, remindedFor: d.remindedFor }, data: { remindedFor: mark } });
    if (claimed.count === 0) continue;
    if (d.type.notifyTeacher) {
      await notifyUser(d.userId, "DOC_EXPIRING", { type: d.type.name, expiry: pickedDateKey(d.expiryDate!), daysLeft: left }, "/documents");
    }
    sent.push({ name: d.user.name, type: d.type.name, left });
  }
  if (sent.length > 0) {
    sent.sort((a, b) => a.left - b.left);
    const list = sent.slice(0, 5).map((x) => `${x.name} (${x.type})`).join(", ");
    await notifyAdmins("DOCS_EXPIRING", { count: sent.length, expired: sent.filter((x) => x.left < 0).length, list, more: Math.max(0, sent.length - 5) }, "/documents");
  }
  return sent.length;
}

function monthsAgo(now: Date, months: number) {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

/** Deletes data past its retention window. Returns the number of records touched. */
export async function purgeExpiredData(now: Date, attendanceMonths: number, attachmentMonths: number, selfieDays: number): Promise<number> {
  let n = 0;
  const parts: string[] = [];
  const selfies = await prisma.selfie.deleteMany({ where: { createdAt: { lt: new Date(+now - selfieDays * 86_400_000) } } });
  n += selfies.count;
  if (selfies.count) parts.push(`selfies=${selfies.count}`);

  if (attendanceMonths > 0) {
    const cutoff = monthsAgo(now, attendanceMonths);
    const [a, t, l] = await prisma.$transaction([
      prisma.attendance.deleteMany({ where: { date: { lt: cutoff } } }),
      prisma.timeAttestation.deleteMany({ where: { date: { lt: cutoff }, status: { not: "PENDING" } } }),
      prisma.leaveRequest.deleteMany({ where: { endDate: { lt: cutoff }, status: { not: "PENDING" } } }),
    ]);
    n += a.count + t.count + l.count;
    if (a.count + t.count + l.count) parts.push(`attendance=${a.count} attest=${t.count} leave=${l.count} (<${attendanceMonths}mo)`);
  }

  if (attachmentMonths > 0) {
    const cutoff = monthsAgo(now, attachmentMonths);
    // Medical certificates etc. are sensitive — drop the file, keep the request record.
    const [l, f] = await prisma.$transaction([
      prisma.leaveRequest.updateMany({ where: { endDate: { lt: cutoff }, attachmentData: { not: null } }, data: { attachmentData: null, attachmentSize: null } }),
      prisma.issueReport.updateMany({ where: { createdAt: { lt: cutoff }, attachmentData: { not: null } }, data: { attachmentData: null, attachmentSize: null } }),
    ]);
    n += l.count + f.count;
    if (l.count + f.count) parts.push(`attachments leave=${l.count} feedback=${f.count} (<${attachmentMonths}mo)`);
  }

  await prisma.reminderLog.deleteMany({ where: { createdAt: { lt: new Date(+now - 60 * 86_400_000) } } });
  if (parts.length) await logAudit({ action: "RETENTION_PURGE", detail: parts.join(" · "), device: "system (scheduler)" });
  return n;
}

// --- in-process ticker -------------------------------------------------------

const TICK_MS = 5 * 60_000;
type G = typeof globalThis & { __tsScheduler?: { timer: ReturnType<typeof setInterval>; running: boolean } };

export async function tickOnce(): Promise<TickResult | null> {
  const g = globalThis as G;
  if (g.__tsScheduler?.running) return null;
  if (g.__tsScheduler) g.__tsScheduler.running = true;
  try {
    return await runScheduledJobs();
  } catch (err) {
    console.error("[scheduler] tick failed", err);
    return null;
  } finally {
    if (g.__tsScheduler) g.__tsScheduler.running = false;
  }
}

export function startScheduler() {
  const g = globalThis as G;
  if (g.__tsScheduler) return;
  g.__tsScheduler = { timer: setInterval(() => void tickOnce(), TICK_MS), running: false };
  // First run shortly after boot (not during it).
  setTimeout(() => void tickOnce(), 45_000);
  console.log("[scheduler] started — every", TICK_MS / 60_000, "min");
}
